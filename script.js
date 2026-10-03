import { evaluateRecordQuality, findProbableDuplicate, generateUniqueId, getCurrentLocalDate, getEvidenceType, isValidInteractionLink, selectRecentRecords } from './modules/records.js';

import { loadFromStorage, readCollectionForUpdate, saveStorageValues, saveToStorage, updateStorageUsage, preloadStorage } from './modules/storage.js';

import { ACTIVE_RECORD_DRAFT_KEY, DEFAULT_QUALITY_RULES, GUIDED_FLOW_STATE_KEY, ONBOARDING_STATE_KEY, PROVIDER_MODEL_CATALOG, QUALITY_RULES_KEY, RECORD_FORM_FIELDS, REMINDER_SETTINGS_KEY, REMINDER_STATE_KEY, appState, ui } from './modules/runtime.js';

const featureLoads = new Map();
const featureLoaders = {
    declaration: () => import('./modules/declaration.js'),
    stats: () => import('./modules/statistics.js'),
    tools: () => Promise.all([import('./modules/management.js'), import('./modules/transfer.js')])
};

function ensureFeature(name) {
    if (!featureLoaders[name]) return Promise.resolve();
    if (!featureLoads.has(name)) {
        featureLoads.set(name, featureLoaders[name]().catch(error => {
            featureLoads.delete(name);
            throw error;
        }));
    }
    return featureLoads.get(name);
}

let startupPromise = null;
let startupInitialized = false;

function startApp() {
    if (startupPromise) return startupPromise;
    if (document.documentElement.dataset.appReady === 'true') return Promise.resolve();
    startupPromise = loadInitialData().finally(() => { startupPromise = null; });
    return startupPromise;
}

async function loadInitialData() {
    let loaded = false;
    const retrying = startupInitialized;
    const main = document.getElementById('main');
    const startupStatus = document.getElementById('startup-status');
    const startupMessage = document.getElementById('startup-status-message');
    const retryButton = document.getElementById('retry-load-btn');
    main.inert = true;
    main.setAttribute('aria-busy', 'true');
    document.documentElement.dataset.appReady = 'loading';
    retryButton.disabled = true;
    if (retrying) startupMessage.textContent = 'Volviendo a cargar los datos…';
    performance.mark('chatlog-start');
    if (!startupInitialized) {
        initTabNavigation();
        setupGlobalEventListeners();
        initButtonHelp();
        setupMainTab();
        initOtherPurposeField();
        initRatingSystem();
        initTagsSystem();
        document.getElementById('interaction-date').value = getCurrentLocalDate();
        startupInitialized = true;
    }
    try {
        const preloaded = await preloadStorage(['chatlog_projects', 'chatlog_records', ACTIVE_RECORD_DRAFT_KEY,
            QUALITY_RULES_KEY, GUIDED_FLOW_STATE_KEY, ONBOARDING_STATE_KEY,
            REMINDER_SETTINGS_KEY, REMINDER_STATE_KEY], {refresh: retrying});
        if (!preloaded) throw new Error('No se pudo cargar la información almacenada');
        if (['chatlog_projects', 'chatlog_records', ACTIVE_RECORD_DRAFT_KEY]
            .some(key => !appState.storageCache.has(key))) throw new Error('No se pudo leer la información de recuperación');
        for (const key of ['chatlog_projects', 'chatlog_records']) {
            const data = appState.storageCache.get(key);
            if (data !== null && (!Array.isArray(data) || data.some(item => !item || typeof item !== 'object')))
                throw new Error('Una colección almacenada no tiene el formato esperado');
        }
        const savedRules = await loadFromStorage(QUALITY_RULES_KEY);
        appState.qualityRules = {...DEFAULT_QUALITY_RULES, ...(savedRules || {})};
        appState.qualityRulesLoaded = true;
        await Promise.all([loadProjects(), initGuidedFlowDisplay()]);
        await restoreActiveRecordDraft();
        await loadQuickAccessList();
        await initOnboarding();
        loaded = true;
    } catch (error) {
        console.error('No se pudo completar la apertura de ChatLog:', error);
        startupMessage.textContent = 'No se pudieron cargar los datos. La captura está detenida para proteger tus registros. Pulsa «Reintentar» para volver a cargarlos.';
        startupStatus.hidden = false;
    } finally {
        main.inert = !loaded;
        main.setAttribute('aria-busy', 'false');
        retryButton.disabled = false;
        if (loaded) {
            startupStatus.hidden = true;
            if (document.activeElement === retryButton) document.getElementById('project-select').focus();
        }
        document.documentElement.dataset.appReady = loaded ? 'true' : 'error';
        performance.mark('chatlog-ready');
        const startup = performance.measure('chatlog-startup', 'chatlog-start', 'chatlog-ready');
        document.documentElement.dataset.startupMs = startup.duration.toFixed(2);
    }
    if (!loaded) return;
    const finishStartup = () => {
        Promise.all([updateAllTags(), refreshGuidedFlowState(), evaluateBackupReminder()])
            .catch(error => console.error('Error al actualizar las ayudas iniciales:', error));
        updateStorageUsage();
    };
    if (window.requestIdleCallback) window.requestIdleCallback(finishStartup, {timeout: 750});
    else setTimeout(finishStartup, 0);
}

document.addEventListener('DOMContentLoaded', startApp);

function initTabNavigation() {
    const tabButtons = Array.from(document.querySelectorAll('.tab-button'));

    tabButtons.forEach((button, index) => {
        button.tabIndex = button.classList.contains('active') ? 0 : -1;
        button.addEventListener('click', async function() {
            await activateTab(this);
        });
        button.addEventListener('keydown', async event => {
            const navigationKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
            if (!navigationKeys.includes(event.key)) return;

            event.preventDefault();
            let nextIndex = index;
            if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabButtons.length;
            else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
            else if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = tabButtons.length - 1;

            tabButtons[nextIndex].focus();
            await activateTab(tabButtons[nextIndex]);
        });
    });
}

async function activateTab(button) {
    if (!await flushRecordAutosave()) return;
    const tabName = button.getAttribute('data-tab');

    document.querySelectorAll('.tab-button').forEach(tabButton => {
        const isActive = tabButton === button;
        tabButton.classList.toggle('active', isActive);
        tabButton.setAttribute('aria-selected', String(isActive));
        tabButton.tabIndex = isActive ? 0 : -1;
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabName);
    });

    await initializeTab(tabName);
}

async function initializeTab(tabName) {
    if (tabName === 'main') return;
    try { await ensureFeature(tabName); } catch (error) {
        console.error('Error al abrir la sección:', error);
        showAppStatus('No se pudo abrir esta sección. Vuelve a seleccionarla para reintentar.', 'error');
        return;
    }

    if (!appState.initializedTabs.has(tabName)) {
        if (tabName === 'declaration') ui.setupDeclarationTab();
        else if (tabName === 'stats') ui.setupStatisticsTab();
        else if (tabName === 'tools') ui.setupToolsTab();
        appState.initializedTabs.add(tabName);
    }

    if (tabName === 'declaration') {
        await loadQualityReviewSettings();
        await Promise.all([ui.loadDeclarationProjects(), ui.loadRecordsForDeclaration()]);
    } else if (tabName === 'stats') {
        await ui.loadStatistics();
    } else if (tabName === 'tools') {
        await Promise.all([initReminderSettings(), loadQualityReviewSettings()]);
        await Promise.all([ui.loadProjectsForManagement(), ui.initRecordsManagement()]);
    }
}

function setupGlobalEventListeners() {
    document.getElementById('retry-load-btn').addEventListener('click', startApp);
    document.getElementById('onboarding-toggle-btn').addEventListener('click', () => openOnboarding());
    document.getElementById('onboarding-close-btn').addEventListener('click', closeOnboarding);
    document.getElementById('onboarding-skip-btn').addEventListener('click', closeOnboarding);
    document.getElementById('onboarding-back-btn').addEventListener('click', showPreviousOnboardingStep);
    document.getElementById('onboarding-next-btn').addEventListener('click', showNextOnboardingStep);
    document.getElementById('about-toggle-btn').addEventListener('click', toggleAboutPanel);
    document.getElementById('about-close-btn').addEventListener('click', closeAboutPanel);
    document.getElementById('dismiss-reminder-btn').addEventListener('click', dismissBackupReminder);
    document.getElementById('app-dialog-confirm-btn').addEventListener('click', () => closeAppDialog(true));
    document.getElementById('app-dialog-cancel-btn').addEventListener('click', () => closeAppDialog(false));

    document.addEventListener('keydown', event => {
        const onboardingOverlay = document.getElementById('onboarding-overlay');
        const appDialogOverlay = document.getElementById('app-dialog-overlay');
        if (event.key === 'Escape' && !appDialogOverlay.hidden) {
            closeAppDialog(false);
        } else if (event.key === 'Tab' && !appDialogOverlay.hidden) {
            keepFocusInsideDialog(event, appDialogOverlay);
        } else if (event.key === 'Escape' && !onboardingOverlay.hidden) {
            closeOnboarding();
        } else if (event.key === 'Tab' && !onboardingOverlay.hidden) {
            keepFocusInsideOnboarding(event);
        }
    });

    window.addEventListener('beforeunload', event => {
        if (!hasPendingRecordChanges()) return;
        event.preventDefault();
        event.returnValue = '';
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flushRecordAutosave();
    });
}

function setupMainTab() {
    document.getElementById('add-project-btn').addEventListener('click', addProject);
    document.getElementById('delete-project-btn').addEventListener('click', deleteProject);
    document.getElementById('project-select').addEventListener('change', async function() {
        if (document.getElementById('record-id').value || appState.recordFormDirty) markRecordFormDirty();
        await handleProjectSelection();
    });

    document.getElementById('record-form').addEventListener('submit', function(e) {
        e.preventDefault();
        saveRecord();
    });
    document.getElementById('record-form').addEventListener('input', markRecordFormDirty);
    document.getElementById('record-form').addEventListener('change', markRecordFormDirty);
    initProviderModelFields();
    document.getElementById('save-and-declare-btn').addEventListener('click', function() {
        const form = document.getElementById('record-form');
        if (form.reportValidity()) saveRecord(true);
    });
    document.getElementById('cancel-edit-btn').addEventListener('click', cancelEditRecord);
    document.getElementById('new-record-btn').addEventListener('click', startNewRecord);
    document.getElementById('retry-save-btn').addEventListener('click', () => flushRecordAutosave());
    document.getElementById('interaction-link').addEventListener('input', clearInteractionLinkError);
    document.getElementById('evidence-type').addEventListener('change', updateEvidenceFields);
    updateEvidenceFields();
    document.getElementById('new-project-name').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addProject();
        }
    });

    document.getElementById('guided-project-btn').addEventListener('click', focusProjectStep);
    document.getElementById('guided-record-btn').addEventListener('click', focusRecordStep);
    document.getElementById('guided-declaration-btn').addEventListener('click', () => openChatLogTab('declaration'));
    document.getElementById('guided-flow-toggle').addEventListener('click', toggleGuidedFlow);
}

function showAppStatus(message, type = 'success') {
    const status = document.getElementById('app-status');
    clearTimeout(appState.appStatusTimer);
    status.textContent = message;
    status.className = `app-status${type === 'success' ? '' : ` is-${type}`}`;
    status.hidden = false;
    appState.appStatusTimer = setTimeout(() => {
        status.hidden = true;
    }, 5000);
}

function openAppDialog(message, options = {}) {
    const overlay = document.getElementById('app-dialog-overlay');
    const title = document.getElementById('app-dialog-title');
    const messageElement = document.getElementById('app-dialog-message');
    const cancelButton = document.getElementById('app-dialog-cancel-btn');
    const confirmButton = document.getElementById('app-dialog-confirm-btn');
    const isConfirmation = options.showCancel !== false;

    if (appState.appDialogResolver) closeAppDialog(false);
    appState.appDialogPreviousFocus = document.activeElement;
    title.textContent = options.title || (isConfirmation ? 'Confirmación' : 'Aviso');
    messageElement.textContent = message;
    cancelButton.hidden = !isConfirmation;
    cancelButton.textContent = options.cancelLabel || 'Cancelar';
    confirmButton.textContent = options.confirmLabel || (isConfirmation ? 'Continuar' : 'Aceptar');
    confirmButton.classList.toggle('app-dialog-confirm-danger', Boolean(options.danger));
    overlay.hidden = false;

    return new Promise(resolve => {
        appState.appDialogResolver = resolve;
        confirmButton.focus();
    });
}

function closeAppDialog(result) {
    const overlay = document.getElementById('app-dialog-overlay');
    if (overlay.hidden) return;

    overlay.hidden = true;
    const resolver = appState.appDialogResolver;
    appState.appDialogResolver = null;
    document.getElementById('app-dialog-confirm-btn').classList.remove('app-dialog-confirm-danger');
    if (appState.appDialogPreviousFocus?.focus) appState.appDialogPreviousFocus.focus();
    appState.appDialogPreviousFocus = null;
    if (resolver) resolver(result);
}

function appConfirm(message, options = {}) {
    return openAppDialog(message, { ...options, showCancel: true });
}

function appAlert(message, options = {}) {
    return openAppDialog(message, { ...options, showCancel: false });
}

function markRecordFormDirty() {
    appState.recordFormDirty = true;
    appState.recordFormChangeVersion += 1;
    if (!document.getElementById('record-id').value) {
        document.getElementById('record-id').value = generateUniqueId('record');
    }
    updateRecordSaveIndicator('Guardado pendiente', 'pending');
    persistActiveRecordDraft();
    scheduleRecordAutosave();
}

function captureActiveRecordDraft() {
    return {
        fields: Object.fromEntries(RECORD_FORM_FIELDS.map(id => [id, document.getElementById(id).value])),
        projectId: document.getElementById('project-select').value,
        tags: [...appState.currentTags],
        isNew: appState.recordFormIsNew
    };
}

function persistActiveRecordDraft(snapshot = captureActiveRecordDraft()) {
    // Serializar las escrituras evita que un borrador antiguo reaparezca al cerrar un registro.
    appState.recoverySaveQueue = appState.recoverySaveQueue.catch(() => false).then(() =>
        saveToStorage(ACTIVE_RECORD_DRAFT_KEY, snapshot, { countBackupChange: false })
    );
    return appState.recoverySaveQueue;
}

async function restoreActiveRecordDraft() {
    const draft = await loadFromStorage(ACTIVE_RECORD_DRAFT_KEY);
    if (!draft?.fields?.['record-id']) return;
    const records = await loadFromStorage('chatlog_records') || [];
    if (!draft.isNew && !records.some(record => record.id === draft.fields['record-id'])) {
        await persistActiveRecordDraft(null);
        return;
    }
    for (const id of RECORD_FORM_FIELDS) {
        if (typeof draft.fields[id] === 'string') document.getElementById(id).value = draft.fields[id];
    }
    const project = document.getElementById('project-select');
    project.value = Array.from(project.options).some(option => option.value === draft.projectId)
        ? draft.projectId : 'none';
    updateProjectCreationControl();
    appState.currentTags = Array.isArray(draft.tags) ? [...draft.tags] : [];
    appState.recordFormIsNew = Boolean(draft.isNew);
    updateTagsList();
    window.loadRating(draft.fields['rating-value'] || 0);
    document.getElementById('other-purpose-container').style.display =
        draft.fields.purpose === 'Otro' ? 'block' : 'none';
    document.getElementById('form-title').textContent = 'Registro recuperado';
    updateEvidenceFields();
    document.getElementById('cancel-edit-btn').style.display = 'inline-block';
    markRecordFormDirty();
    await flushRecordAutosave();
    showAppStatus('Se recuperó el registro en el que estabas trabajando.');
}

async function flushRecordAutosave() {
    clearTimeout(appState.recordAutosaveTimer);
    appState.recordAutosaveTimer = null;
    await appState.recordAutosaveQueue.catch(() => false);
    while (appState.recordFormDirty) {
        const version = appState.recordFormChangeVersion;
        const saved = await queueRecordAutosave(version);
        if (!saved && version === appState.recordFormChangeVersion) return false;
    }
    return true;
}

function queueRecordAutosave(changeVersion) {
    appState.recordAutosaveQueue = appState.recordAutosaveQueue.catch(() => false).then(async () => {
        if (changeVersion !== appState.recordFormChangeVersion) return false;
        appState.recordAutosaveInProgress = true;
        updateRecordSaveIndicator('Guardando…', 'pending');
        try {
            return await saveRecord(false, { autoSave: true, changeVersion });
        } catch (error) {
            console.error('Error en el guardado automático:', error);
            updateRecordSaveIndicator('Error al guardar. Reintenta.', 'error');
            return false;
        } finally {
            appState.recordAutosaveInProgress = false;
        }
    });
    return appState.recordAutosaveQueue;
}

async function startNewRecord() {
    if (!await flushRecordAutosave()) return;
    if (!await persistActiveRecordDraft(null)) return;
    resetRecordForm();
    document.getElementById('interaction-name').focus();
}

function clearRecordFormDirty() {
    appState.recordFormDirty = false;
    const indicator = document.getElementById('record-unsaved-indicator');
    indicator.textContent = 'Cambios sin guardar';
    indicator.hidden = true;
    document.getElementById('retry-save-btn').hidden = true;
}

function scheduleRecordAutosave() {
    clearTimeout(appState.recordAutosaveTimer);
    const scheduledVersion = appState.recordFormChangeVersion;
    appState.recordAutosaveTimer = setTimeout(() => {
        appState.recordAutosaveTimer = null;
        void queueRecordAutosave(scheduledVersion);
    }, 800);
}

function cancelRecordAutosave(invalidatePendingSave = false) {
    clearTimeout(appState.recordAutosaveTimer);
    appState.recordAutosaveTimer = null;
    if (invalidatePendingSave) appState.recordFormChangeVersion += 1;
}

function updateRecordSaveIndicator(message, state = 'saved') {
    const indicator = document.getElementById('record-unsaved-indicator');
    indicator.textContent = message;
    indicator.hidden = false;
    indicator.dataset.state = state;
    document.getElementById('retry-save-btn').hidden = state !== 'error';
}

function hasPendingRecordChanges() {
    return appState.recordFormDirty || Boolean(appState.recordAutosaveTimer) || appState.recordAutosaveInProgress;
}

function retainValidRecordSelection(selection, records) {
    const validRecordIds = new Set(records.map(record => record.id));
    return selection.filter(recordId => validRecordIds.has(recordId));
}

function keepFocusInsideOnboarding(event) {
    keepFocusInsideDialog(event, document.getElementById('onboarding-overlay'));
}

function keepFocusInsideDialog(event, container) {
    const focusableElements = Array.from(container.querySelectorAll(
        'button:not([hidden]):not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => element.offsetParent !== null);
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
    }
}

async function initReminderSettings() {
    const savedSettings = await loadFromStorage(REMINDER_SETTINGS_KEY) || {
        enabled: false,
        frequencyDays: 5,
        changeThreshold: 10
    };
    document.getElementById('backup-reminder-enabled').checked = Boolean(savedSettings.enabled);
    document.getElementById('backup-reminder-frequency').value = String(savedSettings.frequencyDays || 5);
    document.getElementById('backup-reminder-changes').value = String(savedSettings.changeThreshold || 10);
}

async function saveReminderSettings() {
    const settings = {
        enabled: document.getElementById('backup-reminder-enabled').checked,
        frequencyDays: Number(document.getElementById('backup-reminder-frequency').value),
        changeThreshold: Number(document.getElementById('backup-reminder-changes').value)
    };

    const saved = await saveToStorage(REMINDER_SETTINGS_KEY, settings);
    if (saved) {
        showAppStatus('Configuración del recordatorio guardada.');
        if (settings.enabled) {
            document.getElementById('backup-reminder-banner').style.display = 'flex';
        } else {
            document.getElementById('backup-reminder-banner').style.display = 'none';
        }
    }
}

async function evaluateBackupReminder(forceShow = false) {
    const banner = document.getElementById('backup-reminder-banner');
    const settings = await loadFromStorage(REMINDER_SETTINGS_KEY) || {
        enabled: false,
        frequencyDays: 5,
        changeThreshold: 10
    };
    const state = await loadFromStorage(REMINDER_STATE_KEY) || {
        lastDismissedAt: null,
        changesSinceBackup: 0
    };

    if (!settings.enabled) {
        banner.style.display = 'none';
        return;
    }

    if (forceShow || !state.lastDismissedAt) {
        banner.style.display = 'flex';
        return;
    }

    const elapsedDays = (Date.now() - new Date(state.lastDismissedAt).getTime()) / (24 * 60 * 60 * 1000);
    const reachedChangeThreshold =
        Number(state.changesSinceBackup || 0) >= Number(settings.changeThreshold || 10);
    banner.style.display =
        elapsedDays >= settings.frequencyDays || reachedChangeThreshold ? 'flex' : 'none';
}

async function dismissBackupReminder() {
    const saved = await saveToStorage(REMINDER_STATE_KEY, {
        lastDismissedAt: new Date().toISOString(),
        changesSinceBackup: 0
    });
    if (saved) {
        document.getElementById('backup-reminder-banner').style.display = 'none';
    }
}

function trackBackupChange() {
    appState.backupChangeQueue = appState.backupChangeQueue.then(async () => {
        const state = await loadFromStorage(REMINDER_STATE_KEY) || {
            lastDismissedAt: null,
            changesSinceBackup: 0
        };
        await saveToStorage(REMINDER_STATE_KEY, {
            ...state,
            changesSinceBackup: Number(state.changesSinceBackup || 0) + 1
        });
        await evaluateBackupReminder();
    });
}

async function markBackupCompleted() {
    await saveToStorage(REMINDER_STATE_KEY, {
        lastDismissedAt: new Date().toISOString(),
        changesSinceBackup: 0
    });
    await evaluateBackupReminder();
}

async function loadQualityReviewSettings() {
    if (!appState.qualityRulesLoaded) {
        const savedRules = await loadFromStorage(QUALITY_RULES_KEY);
        appState.qualityRules = { ...DEFAULT_QUALITY_RULES, ...(savedRules || {}) };
        appState.qualityRulesLoaded = true;
    }

    const fields = {
        'quality-require-date': appState.qualityRules.requireDate,
        'quality-require-provider': appState.qualityRules.requireProvider,
        'quality-require-stage': appState.qualityRules.requireStage,
        'quality-require-verification': appState.qualityRules.requireVerification,
        'quality-require-project': appState.qualityRules.requireProject
    };
    Object.entries(fields).forEach(([id, checked]) => {
        const element = document.getElementById(id);
        if (element) element.checked = checked;
    });
}

async function saveQualityReviewSettings() {
    appState.qualityRules = {
        requireDate: document.getElementById('quality-require-date').checked,
        requireProvider: document.getElementById('quality-require-provider').checked,
        requireStage: document.getElementById('quality-require-stage').checked,
        requireVerification: document.getElementById('quality-require-verification').checked,
        requireProject: document.getElementById('quality-require-project').checked
    };
    appState.qualityRulesLoaded = true;

    const saved = await saveToStorage(QUALITY_RULES_KEY, appState.qualityRules);
    if (saved) {
        await Promise.all([ui.loadProjectsForManagement(), ui.loadRecordsForManagement()]);
        showAppStatus('Criterios de revisión guardados.');
    }
}

function toggleAboutPanel() {
    const panel = document.getElementById('about-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function closeAboutPanel() {
    document.getElementById('about-panel').style.display = 'none';
}

async function initGuidedFlowDisplay() {
    const savedState = await loadFromStorage(GUIDED_FLOW_STATE_KEY);
    setGuidedFlowCollapsed(Boolean(savedState?.collapsed));
}

async function toggleGuidedFlow() {
    const guidedFlow = document.getElementById('guided-flow');
    const collapsed = !guidedFlow.classList.contains('is-collapsed');
    setGuidedFlowCollapsed(collapsed);
    await saveToStorage(GUIDED_FLOW_STATE_KEY, { collapsed });
}

function setGuidedFlowCollapsed(collapsed) {
    const guidedFlow = document.getElementById('guided-flow');
    const content = document.getElementById('guided-flow-content');
    const toggleButton = document.getElementById('guided-flow-toggle');
    guidedFlow.classList.toggle('is-collapsed', collapsed);
    content.hidden = collapsed;
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    const actionLabel = collapsed ? 'Expandir ruta de trabajo' : 'Contraer ruta de trabajo';
    toggleButton.setAttribute('aria-label', actionLabel);
    toggleButton.title = actionLabel;
}

async function initOnboarding() {
    const onboardingState = await loadFromStorage(ONBOARDING_STATE_KEY);
    if (!onboardingState?.completed) openOnboarding();
}

function openOnboarding() {
    appState.onboardingPreviousFocus = document.activeElement;
    appState.onboardingCurrentStep = 0;
    renderOnboardingStep();

    const overlay = document.getElementById('onboarding-overlay');
    overlay.hidden = false;
    document.body.classList.add('onboarding-open');
    document.getElementById('onboarding-close-btn').focus();
}

async function closeOnboarding() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay.hidden) return;

    overlay.hidden = true;
    document.body.classList.remove('onboarding-open');
    await saveToStorage(ONBOARDING_STATE_KEY, {
        completed: true,
        completedAt: new Date().toISOString()
    });

    if (appState.onboardingPreviousFocus && typeof appState.onboardingPreviousFocus.focus === 'function') {
        appState.onboardingPreviousFocus.focus();
    }
}

function showPreviousOnboardingStep() {
    if (appState.onboardingCurrentStep === 0) return;
    appState.onboardingCurrentStep -= 1;
    renderOnboardingStep();
}

async function showNextOnboardingStep() {
    const steps = document.querySelectorAll('.onboarding-step');
    if (appState.onboardingCurrentStep < steps.length - 1) {
        appState.onboardingCurrentStep += 1;
        renderOnboardingStep();
        return;
    }

    await closeOnboarding();
    focusProjectStep();
}

function renderOnboardingStep() {
    const steps = document.querySelectorAll('.onboarding-step');
    const dots = document.querySelectorAll('.onboarding-progress-dot');

    steps.forEach((step, index) => {
        step.classList.toggle('active', index === appState.onboardingCurrentStep);
    });
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index <= appState.onboardingCurrentStep);
    });

    document.getElementById('onboarding-back-btn').hidden = appState.onboardingCurrentStep === 0;
    document.getElementById('onboarding-next-btn').textContent =
        appState.onboardingCurrentStep === steps.length - 1 ? 'Comenzar' : 'Siguiente';
}

function openChatLogTab(tabName) {
    const tabButton = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
    if (tabButton && !tabButton.classList.contains('active')) tabButton.click();
}

function focusProjectStep() {
    openChatLogTab('main');
    const projectSection = document.getElementById('project-management-section');
    projectSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const projectSelect = document.getElementById('project-select');
    const hasProjects = Array.from(projectSelect.options)
        .some(option => option.value !== 'all' && option.value !== 'none');
    (hasProjects ? projectSelect : document.getElementById('new-project-name')).focus();
}

function focusRecordStep() {
    openChatLogTab('main');
    document.getElementById('form-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('interaction-name').focus();
}

async function refreshGuidedFlowState() {
    const guidedFlow = document.getElementById('guided-flow');
    if (!guidedFlow) return;

    const [projects, records] = await Promise.all([
        loadFromStorage('chatlog_projects'),
        loadFromStorage('chatlog_records')
    ]);
    const hasProjects = (projects || []).length > 0;
    const hasRecords = (records || []).length > 0;
    const hasCompleteRecords = (records || []).some(record => evaluateRecordQuality(record).status !== 'incomplete');
    const projectStep = guidedFlow.querySelector('[data-guided-step="project"]');
    const recordStep = guidedFlow.querySelector('[data-guided-step="record"]');
    const declarationStep = guidedFlow.querySelector('[data-guided-step="declaration"]');

    setGuidedStepState(projectStep, hasProjects ? 'complete' : 'current', hasProjects ? 'Listo' : 'Por comenzar');

    if (!hasProjects) {
        setGuidedStepState(recordStep, hasCompleteRecords ? 'complete' : 'pending', hasCompleteRecords ? 'Listo' : hasRecords ? 'Borrador' : 'Después');
        setGuidedStepState(declarationStep, 'pending', hasCompleteRecords ? 'Disponible' : 'Después');
        document.getElementById('guided-flow-summary').textContent =
            'Comienza creando o seleccionando un proyecto.';
        return;
    }

    if (!hasCompleteRecords) {
        setGuidedStepState(recordStep, 'current', 'Siguiente');
        setGuidedStepState(declarationStep, 'pending', 'Después');
        document.getElementById('guided-flow-summary').textContent =
            hasRecords ? 'Tu borrador está guardado. Completa los campos pendientes para preparar la declaración.'
                : 'El proyecto está listo. Ahora registra tu primera interacción.';
        return;
    }

    setGuidedStepState(recordStep, 'complete', 'Listo');
    setGuidedStepState(declarationStep, 'current', 'Disponible');
    document.getElementById('guided-flow-summary').textContent =
        'Ya puedes generar una declaración o continuar registrando interacciones.';
}

function setGuidedStepState(step, state, label) {
    step.classList.remove('is-complete', 'is-current', 'is-pending');
    step.classList.add(`is-${state}`);
    step.querySelector('.guided-step-status').textContent = label;

    if (state === 'current') step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
}

async function loadProjects() {
    const projects = await loadFromStorage('chatlog_projects') || [];
    const projectSelect = document.getElementById('project-select');
    const currentSelection = projectSelect.value;

    const defaultOptions = Array.from(projectSelect.options).slice(0, 2);
    projectSelect.innerHTML = '';
    defaultOptions.forEach(option => projectSelect.appendChild(option));

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projectSelect.appendChild(option);
    });

    projectSelect.value = Array.from(projectSelect.options).some(option => option.value === currentSelection)
        ? currentSelection : 'all';
    updateProjectCreationControl();
}

async function addProject() {
    const projectNameInput = document.getElementById('new-project-name');
    const container = document.getElementById('new-project-container');
    if (container.hidden) {
        container.hidden = false;
        document.getElementById('add-project-btn').setAttribute('aria-expanded', 'true');
        projectNameInput.focus();
        return;
    }
    const projectName = projectNameInput.value.trim();

    if (!projectName) {
        showAppStatus('Por favor, ingresa un nombre para el proyecto.', 'error');
        projectNameInput.focus();
        return;
    }

    const storedProjects = await loadFromStorage('chatlog_projects');
    if (!appState.storageCache.has('chatlog_projects') || (storedProjects !== null && !Array.isArray(storedProjects))) {
        showAppStatus('No se pudieron leer los proyectos existentes. No se creó el proyecto; vuelve a intentarlo.', 'error');
        return;
    }
    const projects = storedProjects || [];

    if (projects.some(p => p.name.toLowerCase() === projectName.toLowerCase())) {
        showAppStatus('Ya existe un proyecto con ese nombre.', 'error');
        projectNameInput.focus();
        return;
    }

    const newProject = {
        id: generateUniqueId('project'),
        name: projectName,
        dateCreated: new Date().toISOString()
    };

    const saved = await saveToStorage('chatlog_projects', [...projects, newProject]);
    if (saved) {
        projectNameInput.value = '';
        await loadProjects();

        if (document.getElementById('tools').classList.contains('active')) {
            await ui.loadProjectsForManagement();
            await ui.initRecordsManagement();
        }
        const projectSelect = document.getElementById('project-select');
        projectSelect.value = newProject.id;
        if (document.getElementById('record-id').value) markRecordFormDirty();
        await handleProjectSelection();
        showAppStatus(`Proyecto "${newProject.name}" creado correctamente.`);
    }
}

async function deleteProject() {
    const projectSelect = document.getElementById('project-select');
    const selectedProjectId = projectSelect.value;

    if (!selectedProjectId || selectedProjectId === 'all' || selectedProjectId === 'none') {
        showAppStatus('Por favor, selecciona un proyecto válido para eliminar.', 'error');
        return;
    }

    if (!await appConfirm(
        '¿Deseas eliminar este proyecto? Las interacciones asociadas no se eliminarán, pero perderán la asociación con el proyecto.',
        { title: 'Eliminar proyecto', confirmLabel: 'Eliminar', danger: true }
    )) {
        return;
    }

    await deleteProjectById(selectedProjectId);
}

async function deleteProjectById(projectId) {
    if (!projectId) return;

    const [projects, records] = await Promise.all([
        readCollectionForUpdate('chatlog_projects'), readCollectionForUpdate('chatlog_records')
    ]);
    if (!projects || !records) return;
    const filteredProjects = projects.filter(project => project.id !== projectId);
    const updatedRecords = records.map(record => record.projectId === projectId
        ? { ...record, projectId: null } : record);
    const saved = await saveStorageValues({
        chatlog_projects: filteredProjects, chatlog_records: updatedRecords
    });
    if (saved) {
        const projectSelect = document.getElementById('project-select');
        projectSelect.value = 'all';
        await loadProjects();
        await loadQuickAccessList();

        if (document.getElementById('tools').classList.contains('active')) {
            await ui.loadProjectsForManagement();
            await ui.initRecordsManagement();
        }
    }
}

function updateProjectCreationControl() {
    const selectedValue = document.getElementById('project-select').value;
    const hasSelectedProject = Boolean(selectedValue && selectedValue !== 'all' && selectedValue !== 'none');
    document.getElementById('new-project-container').hidden = hasSelectedProject;
    document.getElementById('add-project-btn').setAttribute('aria-controls', 'new-project-container');
    document.getElementById('add-project-btn').setAttribute('aria-expanded', String(!hasSelectedProject));
    document.getElementById('delete-project-btn').disabled = !hasSelectedProject;
}

async function handleProjectSelection() {
    const selectedValue = document.getElementById('project-select').value;
    updateProjectCreationControl();

    await loadQuickAccessList(selectedValue);
}

function initRatingSystem() {
    const stars = document.querySelectorAll('.star');
    const ratingText = document.querySelector('.rating-text');
    const ratingValue = document.getElementById('rating-value');

    const ratingDescriptions = ['Sin calificar', 'Insatisfactorio', 'Mejorable', 'Satisfactorio', 'Bueno', 'Excelente'];

    stars.forEach(star => {
        star.addEventListener('click', function() {
            setRating(parseInt(this.getAttribute('data-rating')));
            markRecordFormDirty();
        });
    });

    function setRating(rating) {
        ratingValue.value = rating;
        ratingText.textContent = ratingDescriptions[rating];
        stars.forEach(s => {
            const isActive = parseInt(s.getAttribute('data-rating')) <= rating;
            s.classList.toggle('active', isActive);
            s.setAttribute('aria-pressed', String(isActive));
        });
    }

    window.loadRating = function(rating) {
        setRating(parseInt(rating) || 0);
    };
}

function getProviderModelSuggestions(fieldId, query = '') {
    const key = fieldId === 'provider-company' ? 'provider' : 'model';
    const normalized = query.trim().toLocaleLowerCase();
    return PROVIDER_MODEL_CATALOG.map(pair => pair[key])
        .filter(value => value.toLocaleLowerCase().includes(normalized));
}

function applyProviderModelPair(fieldId) {
    const providerChanged = fieldId === 'provider-company';
    const value = document.getElementById(fieldId).value.trim().toLocaleLowerCase();
    const pair = PROVIDER_MODEL_CATALOG.find(item => providerChanged
        ? [item.provider, ...(item.providerAliases || [])].some(name => name.toLocaleLowerCase() === value)
        : item.model.toLocaleLowerCase() === value);
    if (!pair) return false;
    document.getElementById(providerChanged ? 'llm-name' : 'provider-company').value =
        providerChanged ? pair.model : pair.provider;
    return true;
}

function initProviderModelFields() {
    const controls = ['provider-company', 'llm-name'].map(id => ({
        id,
        input: document.getElementById(id),
        toggle: document.getElementById(`${id}-toggle`),
        list: document.getElementById(`${id}-options`),
        values: [],
        activeIndex: -1
    }));
    const close = control => {
        control.list.hidden = true;
        control.input.setAttribute('aria-expanded', 'false');
        control.toggle.setAttribute('aria-expanded', 'false');
        control.input.removeAttribute('aria-activedescendant');
    };
    const closeAll = () => controls.forEach(close);
    const highlight = control => {
        Array.from(control.list.children).forEach((option, index) => {
            option.setAttribute('aria-selected', String(index === control.activeIndex));
        });
        const active = control.list.children[control.activeIndex];
        if (active) {
            control.input.setAttribute('aria-activedescendant', active.id);
            active.scrollIntoView({ block: 'nearest' });
        }
    };
    const choose = (control, value) => {
        control.input.value = value;
        applyProviderModelPair(control.id);
        closeAll();
        control.input.focus();
        markRecordFormDirty();
    };
    const open = (control, query = '') => {
        closeAll();
        control.values = getProviderModelSuggestions(control.id, query);
        control.list.replaceChildren();
        if (!control.values.length) return;
        control.activeIndex = control.values.indexOf(control.input.value);
        if (control.activeIndex < 0) control.activeIndex = 0;
        control.values.forEach((value, index) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.id = `${control.id}-option-${index}`;
            option.className = 'catalog-option';
            option.textContent = value;
            option.tabIndex = -1;
            option.setAttribute('role', 'option');
            option.addEventListener('mousedown', event => event.preventDefault());
            option.addEventListener('click', () => choose(control, value));
            control.list.appendChild(option);
        });
        control.list.hidden = false;
        control.input.setAttribute('aria-expanded', 'true');
        control.toggle.setAttribute('aria-expanded', 'true');
        highlight(control);
    };
    controls.forEach(control => {
        control.toggle.addEventListener('click', () => {
            if (!control.list.hidden && control.values.length === PROVIDER_MODEL_CATALOG.length) close(control);
            else {
                control.input.focus();
                open(control); // La flecha siempre ofrece todos los pares, aunque ya haya texto.
            }
        });
        control.input.addEventListener('input', () => {
            applyProviderModelPair(control.id);
            open(control, control.input.value);
        });
        control.input.addEventListener('change', () => applyProviderModelPair(control.id));
        control.input.addEventListener('keydown', event => {
            if (event.key === 'Escape' || event.key === 'Tab') {
                closeAll();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (control.list.hidden) open(control);
                else {
                    const direction = event.key === 'ArrowDown' ? 1 : -1;
                    control.activeIndex = (control.activeIndex + direction + control.values.length) % control.values.length;
                    highlight(control);
                }
            } else if (event.key === 'Enter' && !control.list.hidden) {
                event.preventDefault();
                choose(control, control.values[control.activeIndex]);
            }
        });
    });
    document.addEventListener('focusin', event => {
        if (!controls.some(control => control.input.parentElement.parentElement.contains(event.target))) closeAll();
    });
    document.addEventListener('mousedown', event => {
        if (!controls.some(control => control.input.parentElement.parentElement.contains(event.target))) closeAll();
    });
}

function initButtonHelp() {
    const help = {
        'export-all-btn': 'Respaldo para restaurar proyectos y registros en ChatLog. Los archivos de evidencia se guardan aparte.',
        'export-csv-btn': 'Tabla para revisar registros en Excel o Sheets. Para restaurar ChatLog, usa preferentemente JSON.',
        'onboarding-toggle-btn': 'Abre la guía con los pasos para comenzar a usar ChatLog.',
        'about-toggle-btn': 'Consulta la versión, la responsable, la privacidad y el manual de ChatLog.',
        'new-record-btn': 'Conserva el registro actual y abre un formulario vacío para otra interacción.',
        'save-and-declare-btn': 'Comprueba los campos, guarda la interacción y abre la preparación de la declaración.',
        'cancel-edit-btn': 'Conserva los cambios y cierra el registro actual.',
        'retry-save-btn': 'Intenta guardar de nuevo sin borrar lo que escribiste.',
        'add-project-btn': 'Abre el campo de nombre si está oculto. Escribe el nombre y pulsa de nuevo para crear el proyecto.',
        'delete-project-btn': 'Elimina el proyecto seleccionado después de revisar la confirmación.',
        'tab-main': 'Organiza proyectos y registra tus interacciones con modelos de lenguaje.',
        'tab-declaration': 'Selecciona registros y genera un texto para declarar cómo utilizaste la IA.',
        'tab-tools': 'Exporta respaldos, importa datos y revisa la calidad de los registros.',
        'tab-stats': 'Consulta patrones de tus registros locales y filtra por fechas, proyecto o modelo.',
        'select-all-records-btn': 'Incluye todos los registros mostrados en la declaración.',
        'deselect-all-records-btn': 'Quita la selección de registros para la declaración; no los elimina.',
        'generate-declaration-btn': 'Genera el texto con los registros y el formato seleccionados. Revisa su contenido antes de entregarlo.',
        'copy-declaration-btn': 'Copia el texto generado para pegarlo en tu trabajo.',
        'download-declaration-btn': 'Guarda la declaración generada como archivo de texto.',
        'import-data-btn': 'Recupera proyectos y registros de un respaldo JSON. Revisa si vas a fusionar o reemplazar los datos.',
        'import-csv-btn': 'Incorpora registros desde una tabla CSV compatible. Revisa si vas a fusionar o reemplazar los datos.',
        'save-reminder-settings-btn': 'Guarda cuándo quieres recibir un recordatorio para exportar un respaldo; no crea respaldos por sí solo.',
        'dismiss-reminder-btn': 'Cierra este aviso de respaldo.',
        'save-quality-rules-btn': 'Guarda los criterios recomendados para revisar si tus registros están completos.',
        'select-visible-records-btn': 'Selecciona los registros que cumplen los filtros actuales para actuar sobre ellos en conjunto.',
        'clear-record-selection-btn': 'Quita la selección actual sin cambiar ni eliminar registros.',
        'mark-selected-important-btn': 'Marca los registros seleccionados para encontrarlos con mayor facilidad.',
        'delete-selected-records-btn': 'Solicita eliminar los registros seleccionados. Exporta un respaldo antes si necesitas conservarlos.',
        'apply-stats-filters-btn': 'Actualiza las estadísticas usando los filtros elegidos.',
        'reset-stats-filters-btn': 'Quita los filtros de las estadísticas para ver todos los registros.',
        'save-project-edit-btn': 'Guarda el cambio de nombre del proyecto.',
        'cancel-project-edit-btn': 'Cierra la edición del nombre del proyecto sin aplicar el cambio.',
        'guided-project-btn': 'Lleva a la creación y selección de proyectos.',
        'guided-record-btn': 'Lleva al formulario de registro de una interacción.',
        'guided-declaration-btn': 'Lleva a la selección de registros y formatos para declarar el uso de IA.',
        'onboarding-close-btn': 'Cierra la guía; puedes volver a abrirla desde Guía de inicio.',
        'onboarding-skip-btn': 'Cierra la guía y permite comenzar a trabajar.',
        'onboarding-back-btn': 'Regresa al paso anterior de la guía.',
        'onboarding-next-btn': 'Avanza al siguiente paso de la guía o termina el recorrido.',
        'about-close-btn': 'Cierra la información sobre ChatLog.',
        'app-dialog-cancel-btn': 'Cancela la acción indicada en este aviso.',
        'app-dialog-confirm-btn': 'Confirma la acción descrita en este aviso. Revisa sus efectos antes de continuar.'
    };
    const tooltip = document.createElement('div');
    tooltip.id = 'button-help-tooltip';
    tooltip.className = 'button-help-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    const show = event => {
        const button = event.target.closest('button');
        if (!button) return;
        const label = button.textContent.trim();
        const text = help[button.id] || button.title ||
            (button.dataset.rating ? `Valora la utilidad de esta interacción con ${button.dataset.rating} estrellas.` :
            button.dataset.qualityFilter ? `Muestra los registros de la categoría ${label}.` :
            ({Editar:'Abre los datos para modificarlos.', Eliminar:'Solicita eliminar este elemento.',
                Duplicar:'Crea una copia del registro para documentar otra interacción.',
                Mover:'Cambia el proyecto al que pertenece el registro.',
                'Marcar importante':'Marca este registro para encontrarlo con mayor facilidad.',
                'Quitar marca':'Quita la marca de importancia sin eliminar el registro.',
                'Ver detalles':'Muestra todos los datos del registro.'}[label] || button.getAttribute('aria-label') || label));
        button.setAttribute('aria-description', text);
        tooltip.textContent = text;
        tooltip.hidden = false;
        const rect = button.getBoundingClientRect();
        tooltip.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 8))}px`;
        const below = rect.bottom + 8;
        tooltip.style.top = `${below + tooltip.offsetHeight <= window.innerHeight - 8 ? below : Math.max(8, rect.top - tooltip.offsetHeight - 8)}px`;
    };
    const hide = () => { tooltip.hidden = true; };
    document.addEventListener('mouseover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('mouseout', hide);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, true);
}

function updateEvidenceFields() {
    const local = document.getElementById('evidence-type').value === 'local';
    const link = document.getElementById('interaction-link');
    const reference = document.getElementById('evidence-reference');
    document.getElementById('interaction-link-container').hidden = local;
    document.getElementById('evidence-reference-container').hidden = !local;
    link.disabled = local;
    link.required = !local;
    reference.disabled = !local;
    reference.required = local;
    clearInteractionLinkError();
}

function showInteractionLinkError(message) {
    const input = document.getElementById('interaction-link');
    const error = document.getElementById('interaction-link-error');
    input.setAttribute('aria-invalid', 'true');
    input.setCustomValidity(message);
    error.textContent = message;
    error.hidden = false;
}

function clearInteractionLinkError() {
    const input = document.getElementById('interaction-link');
    input.removeAttribute('aria-invalid');
    input.setCustomValidity('');
    document.getElementById('interaction-link-error').hidden = true;
}

async function saveRecord(goToDeclaration = false, options = {}) {
    const autoSave = Boolean(options.autoSave);
    let saveVersion = options.changeVersion ?? appState.recordFormChangeVersion;
    if (autoSave && saveVersion !== appState.recordFormChangeVersion) return false;
    if (!autoSave) {
        cancelRecordAutosave(true);
        await appState.recordAutosaveQueue.catch(() => {});
        saveVersion = appState.recordFormChangeVersion;
    }

    const recordId = document.getElementById('record-id').value;
    const interactionName = document.getElementById('interaction-name').value.trim();
    const purposeValue = document.getElementById('purpose').value;
    const purpose = purposeValue === 'Otro'
        ? document.getElementById('other-purpose').value.trim()
        : purposeValue;
    const providerCompany = document.getElementById('provider-company').value.trim();
    const llmName = document.getElementById('llm-name').value.trim();
    const llmVersion = document.getElementById('llm-version').value.trim();
    const prompt = document.getElementById('prompt').value.trim();
    const interactionLink = document.getElementById('interaction-link').value.trim();
    const evidenceType = document.getElementById('evidence-type').value === 'local' ? 'local' : 'url';
    const evidenceReference = document.getElementById('evidence-reference').value.trim();
    const ethicalNotes = document.getElementById('ethical-notes').value.trim();
    const biasNotes = document.getElementById('bias-notes').value.trim();
    const observations = document.getElementById('observations').value.trim();
    const rating = document.getElementById('rating-value').value;

    const projectSelect = document.getElementById('project-select');
    const selectedProject = projectSelect.value;
    const projectId = (selectedProject !== 'all' && selectedProject !== 'none') ? selectedProject : null;

    const incomplete = evaluateRecordQuality({interactionName, purpose, llmName, prompt, interactionLink, evidenceType, evidenceReference}).status === 'incomplete';
    if (!autoSave && (!interactionName || !purpose || !llmName || !prompt || !(evidenceType === 'local' ? evidenceReference : interactionLink))) {
        showAppStatus('Faltan campos obligatorios. Revisa el formulario antes de guardar.', 'error');
        return;
    }

    if (!autoSave && evidenceType === 'url' && !isValidInteractionLink(interactionLink)) {
        const message = 'Ingresa una liga válida que comience con http:// o https://.';
        showInteractionLinkError(message);
        showAppStatus(message, 'error');
        document.getElementById('interaction-link').focus();
        return;
    }
    clearInteractionLinkError();

    const records = [...(await loadFromStorage('chatlog_records') || [])];
    if (!appState.storageCache.has('chatlog_records')) {
        throw new Error('No se pudieron leer los registros existentes; se conserva el formulario.');
    }
    if (saveVersion !== appState.recordFormChangeVersion) return false;
    const existingRecord = recordId ? records.find(record => record.id === recordId) : null;
    if (recordId && !existingRecord && !appState.recordFormIsNew) {
        if (autoSave) return false;
        showAppStatus('El registro que intentas editar ya no existe.', 'error');
        resetRecordForm();
        return false;
    }
    const interactionDate = document.getElementById('interaction-date').value || getCurrentLocalDate();

    const record = {
        ...existingRecord,
        id: recordId || generateUniqueId('record'),
        interactionName,
        purpose,
        interactionDate,
        providerCompany,
        llmName,
        llmVersion,
        prompt,
        interactionLink,
        evidenceType,
        evidenceReference,
        tags: [...appState.currentTags],
        ethicalNotes,
        biasNotes,
        observations,
        rating,
        projectId,
        isImportant: Boolean(existingRecord?.isImportant),
        isDraft: Boolean(incomplete),
        dateCreated: existingRecord?.dateCreated || new Date().toISOString(),
        dateModified: new Date().toISOString()
    };

    const probableDuplicate = findProbableDuplicate(records, record);
    if (probableDuplicate && !autoSave) {
        const continueSaving = await appConfirm(
            `Este registro se parece a "${probableDuplicate.interactionName}". ¿Deseas guardarlo de todos modos?`,
            { title: 'Posible registro duplicado', confirmLabel: 'Guardar de todos modos' }
        );
        if (!continueSaving) {
            showAppStatus('No se guardó el registro. Puedes revisar el posible duplicado.', 'warning');
            return;
        }
    }

    if (saveVersion !== appState.recordFormChangeVersion) return false;
    if (existingRecord) {
        const index = records.findIndex(r => r.id === recordId);
        if (index !== -1) records[index] = record;
    } else {
        records.push(record);
    }

    const saved = await saveToStorage('chatlog_records', records, {
        countBackupChange: !existingRecord || !autoSave
    });
    if (saved) {
        if (document.getElementById('record-id').value === record.id || !recordId) {
            document.getElementById('record-id').value = record.id;
            appState.recordFormIsNew = false;
        }
        if (autoSave) {
            await Promise.all([
                loadQuickAccessList(selectedProject !== 'all' ? selectedProject : null),
                updateAllTags()
            ]);

            if (appState.recordFormChangeVersion === saveVersion) {
                const recoverySaved = await persistActiveRecordDraft();
                if (!recoverySaved) {
                    updateRecordSaveIndicator('Error al guardar la recuperación. Reintenta.', 'error');
                    return false;
                }
                if (appState.recordFormChangeVersion !== saveVersion) return true;
                clearRecordFormDirty();
                updateRecordSaveIndicator(incomplete ? 'Borrador guardado · faltan campos' : 'Guardado');
            }
            await evaluateBackupReminder();
            return true;
        }

        await persistActiveRecordDraft();
        clearRecordFormDirty();
        updateRecordSaveIndicator('Guardado');
        await loadQuickAccessList(selectedProject !== 'all' ? selectedProject : null);
        await updateTagsList();

        if (document.getElementById('tools').classList.contains('active')) {
            await ui.loadRecordsForManagement();
        }

        showAppStatus(recordId ? 'Registro actualizado correctamente.' : 'Registro guardado correctamente.');
        await evaluateBackupReminder();

        if (goToDeclaration) openChatLogTab('declaration');
        return true;
    }
    updateRecordSaveIndicator('Error al guardar. Reintenta.', 'error');
    return false;
}

async function loadQuickAccessList(projectFilter = null) {
    const records = await loadFromStorage('chatlog_records') || [];
    const recentRecords = selectRecentRecords(records, projectFilter);

    const noRecordsMessage = document.getElementById('no-records-message');
    const recentRecordsList = document.getElementById('recent-records');

    if (recentRecords.length === 0) {
        noRecordsMessage.style.display = 'block';
        recentRecordsList.innerHTML = '';
        return;
    }

    noRecordsMessage.style.display = 'none';
    recentRecordsList.innerHTML = '';

    recentRecords.forEach(record => {
        const li = document.createElement('li');

        const titleSpan = document.createElement('span');
        titleSpan.textContent = record.interactionName || 'Borrador sin nombre';
        if (evaluateRecordQuality(record).status === 'incomplete') {
            titleSpan.textContent += ' · Incompleto';
        }

        if (record.isImportant) {
            const importantSpan = document.createElement('span');
            importantSpan.className = 'important-record-marker';
            importantSpan.textContent = 'Importante:';
            li.appendChild(importantSpan);
        }
        li.appendChild(titleSpan);

        if (record.rating && parseInt(record.rating) > 0) {
            const ratingSpan = document.createElement('span');
            ratingSpan.className = 'list-rating';
            ratingSpan.innerHTML = '&nbsp;' + '★'.repeat(parseInt(record.rating));
            ratingSpan.style.color = 'var(--star-active)';
            ratingSpan.style.fontSize = '0.9em';
            li.appendChild(ratingSpan);
        }

        li.setAttribute('data-record-id', record.id);
        li.setAttribute('role', 'button');
        li.setAttribute('tabindex', '0');
        li.setAttribute('aria-label', `Editar registro: ${record.interactionName}`);
        li.addEventListener('click', function() {
            loadRecordForEdit(record.id);
        });
        li.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                loadRecordForEdit(record.id);
            }
        });

        recentRecordsList.appendChild(li);
    });
}

async function loadRecordForEdit(recordId) {
    if (!await flushRecordAutosave()) return;
    cancelRecordAutosave(true);

    const records = await loadFromStorage('chatlog_records') || [];
    const record = records.find(r => r.id === recordId);

    if (!record) {
        showAppStatus('No se pudo encontrar el registro para editar.', 'error');
        return;
    }

    document.getElementById('form-title').textContent = 'Editar Registro';
    appState.recordFormIsNew = false;
    document.getElementById('record-id').value = record.id;
    document.getElementById('interaction-name').value = record.interactionName;

    const purposeField = document.getElementById('purpose');
    if (Array.from(purposeField.options).some(option => option.value === record.purpose)) {
        purposeField.value = record.purpose;
        document.getElementById('other-purpose-container').style.display = 'none';
    } else {
        purposeField.value = 'Otro';
        document.getElementById('other-purpose-container').style.display = 'block';
        document.getElementById('other-purpose').value = record.purpose;
    }

    document.getElementById('interaction-date').value = record.interactionDate || getCurrentLocalDate();
    document.getElementById('provider-company').value = record.providerCompany || '';
    document.getElementById('llm-name').value = record.llmName;
    document.getElementById('llm-version').value = record.llmVersion || '';
    document.getElementById('prompt').value = record.prompt;
    document.getElementById('interaction-link').value = record.interactionLink || '';
    document.getElementById('evidence-type').value = getEvidenceType(record);
    document.getElementById('evidence-reference').value = record.evidenceReference || '';
    updateEvidenceFields();
    document.getElementById('ethical-notes').value = record.ethicalNotes || '';
    document.getElementById('bias-notes').value = record.biasNotes || '';
    document.getElementById('observations').value = record.observations || '';

    window.loadRating(record.rating || 0);

    appState.currentTags = Array.isArray(record.tags) ? [...record.tags] : [];
    updateTagsList();

    const projectSelect = document.getElementById('project-select');
    projectSelect.value = record.projectId ? record.projectId : 'none';
    updateProjectCreationControl();

    document.getElementById('cancel-edit-btn').style.display = 'inline-block';
    clearInteractionLinkError();
    clearRecordFormDirty();
    await persistActiveRecordDraft();
    updateRecordSaveIndicator(evaluateRecordQuality(record).status === 'incomplete' ? 'Borrador guardado · faltan campos' : 'Guardado');
    document.getElementById('form-title').scrollIntoView({ behavior: 'smooth' });
}

function resetRecordForm() {
    cancelRecordAutosave(true);
    document.getElementById('form-title').textContent = 'Nuevo Registro';
    document.getElementById('record-form').reset();
    document.getElementById('evidence-type').value = 'url';
    document.getElementById('evidence-reference').value = '';
    updateEvidenceFields();
    document.getElementById('record-id').value = '';
    appState.recordFormIsNew = true;
    void persistActiveRecordDraft(null);
    document.getElementById('interaction-date').value = getCurrentLocalDate();
    document.getElementById('other-purpose-container').style.display = 'none';
    document.getElementById('cancel-edit-btn').style.display = 'none';
    appState.currentTags = [];
    updateTagsList();
    window.loadRating(0);
    clearInteractionLinkError();
    clearRecordFormDirty();
}

async function cancelEditRecord() {
    await startNewRecord();
}

function initTagsSystem() {

    const tagsInput = document.getElementById('tags-input');
    const tagsSuggestions = document.getElementById('tags-suggestions');
    tagsInput.addEventListener('focus', updateAllTags);

    tagsInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(this.value.trim());
            this.value = '';
            markRecordFormDirty();
        }
    });

    tagsInput.addEventListener('keyup', function(e) {
        if (!['Enter', ',', 'ArrowDown', 'ArrowUp', 'Escape'].includes(e.key)) {
            const inputVal = this.value.trim();
            inputVal.length > 0 ? showTagSuggestions(inputVal) : (tagsSuggestions.style.display = 'none');
        } else if (e.key === 'Escape') {
            tagsSuggestions.style.display = 'none';
        }
    });

    document.addEventListener('click', function(e) {
        if (!tagsInput.contains(e.target) && !tagsSuggestions.contains(e.target)) {
            tagsSuggestions.style.display = 'none';
        }
    });
}

async function updateAllTags() {
    const records = await loadFromStorage('chatlog_records') || [];
    const tagsSet = new Set();
    records.forEach(record => {
        if (record.tags && Array.isArray(record.tags)) {
            record.tags.forEach(tag => tagsSet.add(tag));
        }
    });
    appState.allTags = Array.from(tagsSet).sort();
}

function showTagSuggestions(input) {
    const suggestions = appState.allTags.filter(tag =>
        tag.toLowerCase().includes(input.toLowerCase()) && !appState.currentTags.includes(tag)
    );
    const tagsSuggestions = document.getElementById('tags-suggestions');

    if (suggestions.length === 0) {
        tagsSuggestions.style.display = 'none';
        return;
    }

    tagsSuggestions.innerHTML = '';
    suggestions.forEach(suggestion => {
        const div = document.createElement('div');
        div.className = 'suggestion-item';
        div.textContent = suggestion;
        div.addEventListener('click', function() {
            addTag(suggestion);
            document.getElementById('tags-input').value = '';
            markRecordFormDirty();
            tagsSuggestions.style.display = 'none';
        });
        tagsSuggestions.appendChild(div);
    });
    tagsSuggestions.style.display = 'block';
}

function addTag(tag) {
    tag = tag.trim();
    if (!tag) return;

    if (!appState.currentTags.includes(tag)) {
        appState.currentTags.push(tag);
        updateTagsList();
        markRecordFormDirty();
        document.getElementById('tags').value = JSON.stringify(appState.currentTags);
        if (!appState.allTags.includes(tag)) {
            appState.allTags.push(tag);
            appState.allTags.sort();
        }
    }
}

function removeTag(tag) {
    const index = appState.currentTags.indexOf(tag);
    if (index !== -1) {
        appState.currentTags.splice(index, 1);
        updateTagsList();
        markRecordFormDirty();
        document.getElementById('tags').value = JSON.stringify(appState.currentTags);
    }
}

function updateTagsList() {
    const tagsList = document.getElementById('tags-list');
    tagsList.innerHTML = '';

    appState.currentTags.forEach(tag => {
        const tagElement = document.createElement('div');
        tagElement.className = 'tag-item';

        const tagText = document.createElement('span');
        tagText.textContent = tag;

        const removeBtn = document.createElement('span');
        removeBtn.className = 'tag-remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => removeTag(tag));

        tagElement.appendChild(tagText);
        tagElement.appendChild(removeBtn);
        tagsList.appendChild(tagElement);
    });
}

function initOtherPurposeField() {
    const purposeSelect = document.getElementById('purpose');
    const otherContainer = document.getElementById('other-purpose-container');

    purposeSelect.addEventListener('change', function() {
        otherContainer.style.display = this.value === 'Otro' ? 'block' : 'none';
    });
}

Object.assign(ui, { saveReminderSettings, saveQualityReviewSettings, showAppStatus, refreshGuidedFlowState, trackBackupChange, appConfirm, deleteProjectById, loadProjects, loadQuickAccessList, cancelRecordAutosave, resetRecordForm, updateAllTags, loadRecordForEdit, retainValidRecordSelection, loadQualityReviewSettings, markBackupCompleted, flushRecordAutosave, appAlert });

export {ensureFeature, startApp};
