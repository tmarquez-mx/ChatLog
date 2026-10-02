// Variables globales para el sistema de etiquetas
let allTags = [];
let currentTags = [];
// Variables para la declaración
let selectedRecords = [];
const REMINDER_SETTINGS_KEY = 'chatlog_backup_reminder_settings';
const REMINDER_STATE_KEY = 'chatlog_backup_reminder_state';
const QUALITY_RULES_KEY = 'chatlog_quality_rules';
const ONBOARDING_STATE_KEY = 'chatlog_onboarding_state';
const GUIDED_FLOW_STATE_KEY = 'chatlog_guided_flow_state';
const ACTIVE_RECORD_DRAFT_KEY = 'chatlog_active_record_draft';
const RECORD_FORM_FIELDS = ['record-id', 'interaction-name', 'purpose', 'other-purpose',
    'interaction-date', 'provider-company', 'llm-name', 'llm-version', 'prompt',
    'interaction-link', 'evidence-type', 'evidence-reference', 'ethical-notes', 'bias-notes', 'observations', 'rating-value', 'tags-input'];
let recoverySaveQueue = Promise.resolve(true);
let recordFormIsNew = true;
const DEFAULT_QUALITY_RULES = {
    requireDate: true,
    requireProvider: true,
    requireStage: true,
    requireVerification: true,
    requireProject: true
};
const storageCache = new Map();
const pendingStorageLoads = new Map();
const initializedTabs = new Set();
let storageRevision = 0;
let statisticsDataCache = null;
let qualityRules = { ...DEFAULT_QUALITY_RULES };
let qualityRulesLoaded = false;
let onboardingCurrentStep = 0;
let onboardingPreviousFocus = null;
let recordFormDirty = false;
let appStatusTimer = null;
let backupChangeQueue = Promise.resolve();
let recordAutosaveTimer = null;
let recordAutosaveQueue = Promise.resolve();
let recordFormChangeVersion = 0;
let recordAutosaveInProgress = false;
let appDialogResolver = null;
let appDialogPreviousFocus = null;
let uniqueIdCounter = 0;
const managementSelectedRecords = new Set();
let managementVisibleRecordIds = [];

// Inicialización cuando el DOM está listo
document.addEventListener('DOMContentLoaded', async function() {
    console.log('ChatLog inicializando...');

    // Inicializar navegación por pestañas
    initTabNavigation();

    // Configurar la pestaña inicial y los controles globales
    setupGlobalEventListeners();
    initButtonHelp();
    setupMainTab();
    document.getElementById('interaction-date').value = getCurrentLocalDate();

    // Inicializar panel Sobre
    initAboutPanel();

    // Cargar datos iniciales
    await loadProjects();
    await loadQuickAccessList();
    await initGuidedFlowDisplay();
    await refreshGuidedFlowState();
    updateStorageUsage();

    // Inicializar sistema de etiquetas
    await initTagsSystem();

    // Inicializar sistema de finalidad "Otro"
    initOtherPurposeField();

    // Inicializar sistema de calificación por estrellas
    initRatingSystem();
    await restoreActiveRecordDraft();

    // Inicializar recordatorios de respaldo
    await evaluateBackupReminder();

    // Mostrar la guía solo en el primer uso
    await initOnboarding();
});

// --- FUNCIONES PRINCIPALES ---

// Navegación por pestañas
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

    if (!initializedTabs.has(tabName)) {
        if (tabName === 'declaration') setupDeclarationTab();
        else if (tabName === 'stats') setupStatisticsTab();
        else if (tabName === 'tools') setupToolsTab();
        initializedTabs.add(tabName);
    }

    if (tabName === 'declaration') {
        await loadQualityReviewSettings();
        await Promise.all([loadDeclarationProjects(), loadRecordsForDeclaration()]);
    } else if (tabName === 'stats') {
        await loadStatistics();
    } else if (tabName === 'tools') {
        await Promise.all([initReminderSettings(), loadQualityReviewSettings()]);
        await Promise.all([loadProjectsForManagement(), initRecordsManagement()]);
    }
}

function setupGlobalEventListeners() {
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
        if (document.getElementById('record-id').value || recordFormDirty) markRecordFormDirty();
        await handleProjectSelection();
    });

    document.getElementById('record-form').addEventListener('submit', function(e) {
        e.preventDefault();
        saveRecord();
    });
    document.getElementById('record-form').addEventListener('input', markRecordFormDirty);
    document.getElementById('record-form').addEventListener('change', markRecordFormDirty);
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

function setupDeclarationTab() {
    document.getElementById('declaration-project-select').addEventListener('change', filterRecordsForDeclaration);
    document.getElementById('select-all-records-btn').addEventListener('click', selectAllRecords);
    document.getElementById('deselect-all-records-btn').addEventListener('click', deselectAllRecords);
    document.getElementById('generate-declaration-btn').addEventListener('click', generateDeclaration);
    document.getElementById('copy-declaration-btn').addEventListener('click', copyDeclarationToClipboard);
    document.getElementById('download-declaration-btn').addEventListener('click', downloadDeclaration);
    document.getElementById('declaration-work-type').addEventListener('change', applyRecommendedDeclarationFormat);
    document.getElementById('declaration-format').addEventListener('change', updateDeclarationFormatGuidance);
    updateDeclarationFormatGuidance();
}

function setupStatisticsTab() {
    document.getElementById('apply-stats-filters-btn').addEventListener('click', applyStatisticsFilters);
    document.getElementById('reset-stats-filters-btn').addEventListener('click', resetStatisticsFilters);
}

function setupToolsTab() {
    document.getElementById('export-all-btn').addEventListener('click', exportAllData);
    document.getElementById('export-csv-btn').addEventListener('click', exportCSV);
    document.getElementById('import-data-btn').addEventListener('click', importData);
    document.getElementById('import-csv-btn').addEventListener('click', importCSV);
    document.getElementById('import-file').addEventListener('change', previewJSON);
    document.getElementById('csv-file').addEventListener('change', previewCSV);

    document.getElementById('save-project-edit-btn').addEventListener('click', saveProjectEdit);
    document.getElementById('cancel-project-edit-btn').addEventListener('click', cancelProjectEdit);

    document.getElementById('records-search-filter').addEventListener('input', loadRecordsForManagement);
    document.getElementById('records-project-filter').addEventListener('change', handleRecordsProjectFilterChange);
    document.getElementById('records-tags-filter').addEventListener('change', loadRecordsForManagement);
    document.getElementById('records-quality-filter').addEventListener('change', loadRecordsForManagement);
    document.getElementById('records-sort-by').addEventListener('change', loadRecordsForManagement);
    document.getElementById('select-visible-records-btn').addEventListener('click', selectVisibleManagementRecords);
    document.getElementById('clear-record-selection-btn').addEventListener('click', clearManagementRecordSelection);
    document.getElementById('mark-selected-important-btn').addEventListener('click', markSelectedRecordsImportant);
    document.getElementById('delete-selected-records-btn').addEventListener('click', deleteSelectedRecords);
    document.querySelectorAll('.quality-filter-card').forEach(card => {
        card.addEventListener('click', () => showRecordsByQuality(card.dataset.qualityFilter));
    });

    document.getElementById('save-reminder-settings-btn').addEventListener('click', saveReminderSettings);
    document.getElementById('save-quality-rules-btn').addEventListener('click', saveQualityReviewSettings);
}

function showAppStatus(message, type = 'success') {
    const status = document.getElementById('app-status');
    clearTimeout(appStatusTimer);
    status.textContent = message;
    status.className = `app-status${type === 'success' ? '' : ` is-${type}`}`;
    status.hidden = false;
    appStatusTimer = setTimeout(() => {
        status.hidden = true;
    }, 5000);
}

function generateUniqueId(prefix = 'item') {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }

    uniqueIdCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${uniqueIdCounter.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function openAppDialog(message, options = {}) {
    const overlay = document.getElementById('app-dialog-overlay');
    const title = document.getElementById('app-dialog-title');
    const messageElement = document.getElementById('app-dialog-message');
    const cancelButton = document.getElementById('app-dialog-cancel-btn');
    const confirmButton = document.getElementById('app-dialog-confirm-btn');
    const isConfirmation = options.showCancel !== false;

    if (appDialogResolver) closeAppDialog(false);
    appDialogPreviousFocus = document.activeElement;
    title.textContent = options.title || (isConfirmation ? 'Confirmación' : 'Aviso');
    messageElement.textContent = message;
    cancelButton.hidden = !isConfirmation;
    cancelButton.textContent = options.cancelLabel || 'Cancelar';
    confirmButton.textContent = options.confirmLabel || (isConfirmation ? 'Continuar' : 'Aceptar');
    confirmButton.classList.toggle('app-dialog-confirm-danger', Boolean(options.danger));
    overlay.hidden = false;

    return new Promise(resolve => {
        appDialogResolver = resolve;
        confirmButton.focus();
    });
}

function closeAppDialog(result) {
    const overlay = document.getElementById('app-dialog-overlay');
    if (overlay.hidden) return;

    overlay.hidden = true;
    const resolver = appDialogResolver;
    appDialogResolver = null;
    document.getElementById('app-dialog-confirm-btn').classList.remove('app-dialog-confirm-danger');
    if (appDialogPreviousFocus?.focus) appDialogPreviousFocus.focus();
    appDialogPreviousFocus = null;
    if (resolver) resolver(result);
}

function appConfirm(message, options = {}) {
    return openAppDialog(message, { ...options, showCancel: true });
}

function appAlert(message, options = {}) {
    return openAppDialog(message, { ...options, showCancel: false });
}

function markRecordFormDirty() {
    recordFormDirty = true;
    recordFormChangeVersion += 1;
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
        tags: [...currentTags],
        isNew: recordFormIsNew
    };
}

function persistActiveRecordDraft(snapshot = captureActiveRecordDraft()) {
    // Serializar las escrituras evita que un borrador antiguo reaparezca al cerrar un registro.
    recoverySaveQueue = recoverySaveQueue.catch(() => false).then(() =>
        saveToStorage(ACTIVE_RECORD_DRAFT_KEY, snapshot, { countBackupChange: false })
    );
    return recoverySaveQueue;
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
    currentTags = Array.isArray(draft.tags) ? [...draft.tags] : [];
    recordFormIsNew = Boolean(draft.isNew);
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
    clearTimeout(recordAutosaveTimer);
    recordAutosaveTimer = null;
    await recordAutosaveQueue.catch(() => false);
    while (recordFormDirty) {
        const version = recordFormChangeVersion;
        const saved = await queueRecordAutosave(version);
        if (!saved && version === recordFormChangeVersion) return false;
    }
    return true;
}

function queueRecordAutosave(changeVersion) {
    recordAutosaveQueue = recordAutosaveQueue.catch(() => false).then(async () => {
        if (changeVersion !== recordFormChangeVersion) return false;
        recordAutosaveInProgress = true;
        updateRecordSaveIndicator('Guardando…', 'pending');
        try {
            return await saveRecord(false, { autoSave: true, changeVersion });
        } catch (error) {
            console.error('Error en el guardado automático:', error);
            updateRecordSaveIndicator('Error al guardar. Reintenta.', 'error');
            return false;
        } finally {
            recordAutosaveInProgress = false;
        }
    });
    return recordAutosaveQueue;
}

async function startNewRecord() {
    if (!await flushRecordAutosave()) return;
    if (!await persistActiveRecordDraft(null)) return;
    resetRecordForm();
    document.getElementById('interaction-name').focus();
}

function clearRecordFormDirty() {
    recordFormDirty = false;
    const indicator = document.getElementById('record-unsaved-indicator');
    indicator.textContent = 'Cambios sin guardar';
    indicator.hidden = true;
    document.getElementById('retry-save-btn').hidden = true;
}

function scheduleRecordAutosave() {
    clearTimeout(recordAutosaveTimer);
    const scheduledVersion = recordFormChangeVersion;
    recordAutosaveTimer = setTimeout(() => {
        recordAutosaveTimer = null;
        void queueRecordAutosave(scheduledVersion);
    }, 800);
}

function cancelRecordAutosave(invalidatePendingSave = false) {
    clearTimeout(recordAutosaveTimer);
    recordAutosaveTimer = null;
    if (invalidatePendingSave) recordFormChangeVersion += 1;
}

function updateRecordSaveIndicator(message, state = 'saved') {
    const indicator = document.getElementById('record-unsaved-indicator');
    indicator.textContent = message;
    indicator.hidden = false;
    indicator.dataset.state = state;
    document.getElementById('retry-save-btn').hidden = state !== 'error';
}

function hasPendingRecordChanges() {
    return recordFormDirty || Boolean(recordAutosaveTimer) || recordAutosaveInProgress;
}

function retainValidRecordSelection(selection, records) {
    const validRecordIds = new Set(records.map(record => record.id));
    return selection.filter(recordId => validRecordIds.has(recordId));
}

function shouldCountBackupChange(key, options = {}) {
    return (
        (key === 'chatlog_projects' || key === 'chatlog_records') &&
        options.countBackupChange !== false
    );
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

// --- GESTIÓN DE ALMACENAMIENTO ---

// Guarda datos en chrome.storage.local
function saveToStorage(key, data, options = {}) {
    return new Promise((resolve) => {
        try {
            const jsonData = JSON.stringify(data);
            chrome.storage.local.set({ [key]: jsonData }, () => {
                if (chrome.runtime.lastError) {
                    console.error('Error al guardar:', chrome.runtime.lastError);
                    showAppStatus('Error al guardar los datos.', 'error');
                    resolve(false);
                } else {
                    storageCache.set(key, data);
                    storageRevision += 1;
                    if (key === 'chatlog_projects' || key === 'chatlog_records') {
                        statisticsDataCache = null;
                    }
                    updateStorageUsage();
                    if (shouldCountBackupChange(key, options)) {
                        setTimeout(refreshGuidedFlowState, 0);
                        trackBackupChange();
                    } else if (key === 'chatlog_projects' || key === 'chatlog_records') {
                        setTimeout(refreshGuidedFlowState, 0);
                    }
                    resolve(true);
                }
            });
        } catch (error) {
            console.error('Error al guardar en el almacenamiento:', error);
            showAppStatus('Error al guardar los datos.', 'error');
            resolve(false);
        }
    });
}

// Carga datos de chrome.storage.local
function loadFromStorage(key) {
    if (storageCache.has(key)) {
        return Promise.resolve(storageCache.get(key));
    }

    if (pendingStorageLoads.has(key)) {
        return pendingStorageLoads.get(key);
    }

    const loadPromise = new Promise((resolve) => {
        try {
            chrome.storage.local.get([key], (result) => {
                if (chrome.runtime.lastError) {
                    console.error('Error al cargar:', chrome.runtime.lastError);
                    resolve(null);
                } else {
                    try {
                        const data = result[key];
                        const parsedData = data ? JSON.parse(data) : null;
                        storageCache.set(key, parsedData);
                        resolve(parsedData);
                    } catch (error) {
                        console.error('Datos almacenados no válidos:', error);
                        resolve(null);
                    }
                }
            });
        } catch (error) {
            console.error('Error al cargar del almacenamiento:', error);
            resolve(null);
        }
    }).finally(() => pendingStorageLoads.delete(key));

    pendingStorageLoads.set(key, loadPromise);
    return loadPromise;
}

if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;

        Object.entries(changes).forEach(([key, change]) => {
            try {
                storageCache.set(key, change.newValue ? JSON.parse(change.newValue) : null);
            } catch (error) {
                storageCache.delete(key);
            }
        });
        if (changes.chatlog_projects || changes.chatlog_records) {
            statisticsDataCache = null;
        }
        storageRevision += 1;
    });
}

// Actualiza la información de uso del almacenamiento
function updateStorageUsage() {
    chrome.storage.local.getBytesInUse(null, (bytes) => {
        const usageElement = document.getElementById('storage-usage');
        if (!usageElement) return;
        const quotaMB = (chrome.storage.local.QUOTA_BYTES || 10485760) / (1024 * 1024);
        if (bytes < 1024 * 1024) {
            usageElement.textContent = `Uso: ${(bytes / 1024).toFixed(1)}KB / ${quotaMB}MB`;
        } else {
            usageElement.textContent = `Uso: ${(bytes / (1024 * 1024)).toFixed(2)}MB / ${quotaMB}MB`;
        }
    });
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
    backupChangeQueue = backupChangeQueue.then(async () => {
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
    if (!qualityRulesLoaded) {
        const savedRules = await loadFromStorage(QUALITY_RULES_KEY);
        qualityRules = { ...DEFAULT_QUALITY_RULES, ...(savedRules || {}) };
        qualityRulesLoaded = true;
    }

    const fields = {
        'quality-require-date': qualityRules.requireDate,
        'quality-require-provider': qualityRules.requireProvider,
        'quality-require-stage': qualityRules.requireStage,
        'quality-require-verification': qualityRules.requireVerification,
        'quality-require-project': qualityRules.requireProject
    };
    Object.entries(fields).forEach(([id, checked]) => {
        const element = document.getElementById(id);
        if (element) element.checked = checked;
    });
}

async function saveQualityReviewSettings() {
    qualityRules = {
        requireDate: document.getElementById('quality-require-date').checked,
        requireProvider: document.getElementById('quality-require-provider').checked,
        requireStage: document.getElementById('quality-require-stage').checked,
        requireVerification: document.getElementById('quality-require-verification').checked,
        requireProject: document.getElementById('quality-require-project').checked
    };
    qualityRulesLoaded = true;

    const saved = await saveToStorage(QUALITY_RULES_KEY, qualityRules);
    if (saved) {
        await Promise.all([loadProjectsForManagement(), loadRecordsForManagement()]);
        showAppStatus('Criterios de revisión guardados.');
    }
}

function initAboutPanel() {
    closeAboutPanel();
}

function toggleAboutPanel() {
    const panel = document.getElementById('about-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function closeAboutPanel() {
    document.getElementById('about-panel').style.display = 'none';
}

// --- GUÍA DE INICIO Y FLUJO GUIADO ---

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
    onboardingPreviousFocus = document.activeElement;
    onboardingCurrentStep = 0;
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

    if (onboardingPreviousFocus && typeof onboardingPreviousFocus.focus === 'function') {
        onboardingPreviousFocus.focus();
    }
}

function showPreviousOnboardingStep() {
    if (onboardingCurrentStep === 0) return;
    onboardingCurrentStep -= 1;
    renderOnboardingStep();
}

async function showNextOnboardingStep() {
    const steps = document.querySelectorAll('.onboarding-step');
    if (onboardingCurrentStep < steps.length - 1) {
        onboardingCurrentStep += 1;
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
        step.classList.toggle('active', index === onboardingCurrentStep);
    });
    dots.forEach((dot, index) => {
        dot.classList.toggle('active', index <= onboardingCurrentStep);
    });

    document.getElementById('onboarding-back-btn').hidden = onboardingCurrentStep === 0;
    document.getElementById('onboarding-next-btn').textContent =
        onboardingCurrentStep === steps.length - 1 ? 'Comenzar' : 'Siguiente';
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

// --- GESTIÓN DE PROYECTOS ---

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

    const projects = await loadFromStorage('chatlog_projects') || [];

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

    projects.push(newProject);

    const saved = await saveToStorage('chatlog_projects', projects);
    if (saved) {
        projectNameInput.value = '';
        await loadProjects();

        if (document.getElementById('tools').classList.contains('active')) {
            await loadProjectsForManagement();
            await initRecordsManagement();
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

    const projects = await loadFromStorage('chatlog_projects') || [];
    const filteredProjects = projects.filter(project => project.id !== projectId);

    const saved = await saveToStorage('chatlog_projects', filteredProjects, {
        countBackupChange: false
    });
    if (saved) {
        const records = await loadFromStorage('chatlog_records') || [];
        const updatedRecords = records.map(record => {
            if (record.projectId === projectId) {
                record.projectId = null;
            }
            return record;
        });

        await saveToStorage('chatlog_records', updatedRecords);

        const projectSelect = document.getElementById('project-select');
        projectSelect.value = 'all';
        await loadProjects();
        await loadQuickAccessList();

        if (document.getElementById('tools').classList.contains('active')) {
            await loadProjectsForManagement();
            await initRecordsManagement();
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

// --- GESTIÓN Y EDICIÓN DE PROYECTOS ---

async function loadProjectsForManagement() {
    const projects = await loadFromStorage('chatlog_projects') || [];
    const tableBody = document.querySelector('#projects-management-table tbody');

    if (projects.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="no-data-message">No hay proyectos disponibles</td></tr>';
        return;
    }

    projects.sort((a, b) => a.name.localeCompare(b.name));

    const records = await loadFromStorage('chatlog_records') || [];
    const projectHealth = {};
    records.forEach(record => {
        if (record.projectId) {
            if (!projectHealth[record.projectId]) {
                projectHealth[record.projectId] = { total: 0, ready: 0 };
            }
            projectHealth[record.projectId].total += 1;
            if (evaluateRecordQuality(record).status === 'ready') {
                projectHealth[record.projectId].ready += 1;
            }
        }
    });

    tableBody.innerHTML = '';

    projects.forEach(project => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = project.name;

        const dateCell = document.createElement('td');
        dateCell.textContent = new Date(project.dateCreated).toLocaleDateString();

        const recordsCell = document.createElement('td');
        const health = projectHealth[project.id] || { total: 0, ready: 0 };
        recordsCell.textContent = `${health.total} (${health.ready} listos, ${health.total - health.ready} por revisar)`;

        const actionsCell = document.createElement('td');
        const actionButtons = document.createElement('div');
        actionButtons.className = 'action-buttons';

        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', () => editProject(project));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = 'Eliminar';
        deleteBtn.addEventListener('click', async () => {
            if (await appConfirm(
                `¿Deseas eliminar el proyecto "${project.name}"?`,
                { title: 'Eliminar proyecto', confirmLabel: 'Eliminar', danger: true }
            )) {
                await deleteProjectById(project.id);
            }
        });

        actionButtons.appendChild(editBtn);
        actionButtons.appendChild(deleteBtn);
        actionsCell.appendChild(actionButtons);

        row.appendChild(nameCell);
        row.appendChild(dateCell);
        row.appendChild(recordsCell);
        row.appendChild(actionsCell);

        tableBody.appendChild(row);
    });
}

function editProject(project) {
    const editForm = document.getElementById('edit-project-form');
    document.getElementById('edit-project-id').value = project.id;
    const projectNameInput = document.getElementById('edit-project-name');
    projectNameInput.value = project.name;
    editForm.style.display = 'block';
    projectNameInput.focus();
    editForm.scrollIntoView({ behavior: 'smooth' });
}

async function saveProjectEdit() {
    const projectId = document.getElementById('edit-project-id').value;
    const projectName = document.getElementById('edit-project-name').value.trim();

    if (!projectName) {
        showAppStatus('Por favor, ingresa un nombre para el proyecto.', 'error');
        document.getElementById('edit-project-name').focus();
        return;
    }

    const projects = await loadFromStorage('chatlog_projects') || [];

    if (projects.some(p => p.name.toLowerCase() === projectName.toLowerCase() && p.id !== projectId)) {
        showAppStatus('Ya existe otro proyecto con ese nombre.', 'error');
        document.getElementById('edit-project-name').focus();
        return;
    }

    const updatedProjects = projects.map(project =>
        project.id === projectId ? { ...project, name: projectName } : project
    );

    const saved = await saveToStorage('chatlog_projects', updatedProjects);
    if (saved) {
        showAppStatus('Proyecto actualizado correctamente.');
        await loadProjects();
        await loadProjectsForManagement();
        await initRecordsManagement();
        cancelProjectEdit();
    }
}

function cancelProjectEdit() {
    document.getElementById('edit-project-form').style.display = 'none';
    document.getElementById('edit-project-id').value = '';
    document.getElementById('edit-project-name').value = '';
}

// --- SISTEMA DE CALIFICACIÓN ---

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

// --- GESTIÓN DE REGISTROS ---

function getCurrentLocalDate() {
    const currentDate = new Date();
    const timezoneOffset = currentDate.getTimezoneOffset() * 60000;
    return new Date(currentDate.getTime() - timezoneOffset).toISOString().split('T')[0];
}

function isValidInteractionLink(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
        return false;
    }
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

function getEvidenceType(record) {
    return record.evidenceType === 'local' ? 'local' : 'url';
}

function getEvidenceValue(record) {
    return getEvidenceType(record) === 'local' ? record.evidenceReference : record.interactionLink;
}

function getEvidenceLabel(record) {
    return getEvidenceType(record) === 'local' ? 'Evidencia conservada' : 'Enlace a la conversación';
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

function findProbableDuplicate(records, candidate) {
    const candidateName = normalizeDuplicateValue(candidate.interactionName);
    const candidatePrompt = normalizeDuplicateValue(candidate.prompt);
    const candidateLink = normalizeDuplicateValue(getEvidenceValue(candidate));

    return records.find(record => {
        if (record.id === candidate.id) return false;
        const sameLink = candidateLink && getEvidenceType(record) === getEvidenceType(candidate) &&
            normalizeDuplicateValue(getEvidenceValue(record)) === candidateLink;
        const sameNameAndPrompt = candidateName && candidatePrompt &&
            normalizeDuplicateValue(record.interactionName) === candidateName &&
            normalizeDuplicateValue(record.prompt) === candidatePrompt;
        return sameLink || sameNameAndPrompt;
    });
}

async function saveRecord(goToDeclaration = false, options = {}) {
    const autoSave = Boolean(options.autoSave);
    let saveVersion = options.changeVersion ?? recordFormChangeVersion;
    if (autoSave && saveVersion !== recordFormChangeVersion) return false;
    if (!autoSave) {
        cancelRecordAutosave(true);
        await recordAutosaveQueue.catch(() => {});
        saveVersion = recordFormChangeVersion;
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
    if (!storageCache.has('chatlog_records')) {
        throw new Error('No se pudieron leer los registros existentes; se conserva el formulario.');
    }
    if (saveVersion !== recordFormChangeVersion) return false;
    const existingRecord = recordId ? records.find(record => record.id === recordId) : null;
    if (recordId && !existingRecord && !recordFormIsNew) {
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
        tags: [...currentTags],
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

    if (saveVersion !== recordFormChangeVersion) return false;
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
            recordFormIsNew = false;
        }
        if (autoSave) {
            await Promise.all([
                loadQuickAccessList(selectedProject !== 'all' ? selectedProject : null),
                updateAllTags()
            ]);

            if (recordFormChangeVersion === saveVersion) {
                const recoverySaved = await persistActiveRecordDraft();
                if (!recoverySaved) {
                    updateRecordSaveIndicator('Error al guardar la recuperación. Reintenta.', 'error');
                    return false;
                }
                if (recordFormChangeVersion !== saveVersion) return true;
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
            await loadRecordsForManagement();
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
    let records = await loadFromStorage('chatlog_records') || [];

    if (projectFilter) {
        if (projectFilter === 'none') {
            records = records.filter(record => !record.projectId);
        } else if (projectFilter !== 'all') {
            records = records.filter(record => record.projectId === projectFilter);
        }
    }

    records.sort((a, b) => {
        const importanceDifference = Number(Boolean(b.isImportant)) - Number(Boolean(a.isImportant));
        return importanceDifference || new Date(b.dateModified) - new Date(a.dateModified);
    });
    const recentRecords = records.slice(0, 10);

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
    recordFormIsNew = false;
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

    currentTags = Array.isArray(record.tags) ? [...record.tags] : [];
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
    recordFormIsNew = true;
    void persistActiveRecordDraft(null);
    document.getElementById('interaction-date').value = getCurrentLocalDate();
    document.getElementById('other-purpose-container').style.display = 'none';
    document.getElementById('cancel-edit-btn').style.display = 'none';
    currentTags = [];
    updateTagsList();
    window.loadRating(0);
    clearInteractionLinkError();
    clearRecordFormDirty();
}

async function cancelEditRecord() {
    await startNewRecord();
}

// --- GESTIÓN Y EDICIÓN DE REGISTROS ---

async function initRecordsManagement() {
    const projectFilter = document.getElementById('records-project-filter');

    const projects = await loadFromStorage('chatlog_projects') || [];
    const allOption = projectFilter.options[0];
    projectFilter.innerHTML = '';
    projectFilter.appendChild(allOption);

    const noneOption = document.createElement('option');
    noneOption.value = 'none';
    noneOption.textContent = 'Sin proyecto';
    projectFilter.appendChild(noneOption);

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projectFilter.appendChild(option);
    });

    populateExportProjectFilter(projects);
    await loadRecordsForManagement();
}

async function handleRecordsProjectFilterChange() {
    document.getElementById('records-tags-filter').value = '';
    await loadRecordsForManagement();
}

function updateManagementTagFilter(records, projectFilter) {
    const tagFilter = document.getElementById('records-tags-filter');
    const currentValue = tagFilter.value;
    const relevantRecords = records.filter(record => {
        if (projectFilter === 'all') return true;
        if (projectFilter === 'none') return !record.projectId;
        return record.projectId === projectFilter;
    });
    const tags = Array.from(new Set(
        relevantRecords.flatMap(record => Array.isArray(record.tags) ? record.tags : [])
    )).sort((a, b) => a.localeCompare(b, 'es'));

    tagFilter.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = tags.length > 0 ? 'Todas las etiquetas' : 'No hay etiquetas en este proyecto';
    tagFilter.appendChild(allOption);

    tags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        tagFilter.appendChild(option);
    });

    tagFilter.disabled = tags.length === 0;
    tagFilter.value = tags.includes(currentValue) ? currentValue : '';
}

async function loadRecordsForManagement() {
    const records = await loadFromStorage('chatlog_records') || [];
    const projects = await loadFromStorage('chatlog_projects') || [];
    const searchFilter = document.getElementById('records-search-filter').value.trim().toLowerCase();
    const projectFilter = document.getElementById('records-project-filter').value;
    updateManagementTagFilter(records, projectFilter);
    const tagsFilter = document.getElementById('records-tags-filter').value.trim().toLowerCase();
    const qualityFilter = document.getElementById('records-quality-filter').value;
    const sortBy = document.getElementById('records-sort-by').value;
    const duplicateRecords = buildDuplicateRecordMap(records);

    updateRecordsQualitySummary(records, duplicateRecords);
    updateQualityFilterCardState(qualityFilter);
    const existingRecordIds = new Set(records.map(record => record.id));
    managementSelectedRecords.forEach(recordId => {
        if (!existingRecordIds.has(recordId)) managementSelectedRecords.delete(recordId);
    });

    if (records.length === 0) {
        managementVisibleRecordIds = [];
        updateManagementSelectionControls();
        document.getElementById('records-by-project').innerHTML = '<div class="no-data-message">No hay registros disponibles</div>';
        return;
    }

    const projectsMap = {};
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    let filteredRecords = [...records];
    if (searchFilter) {
        filteredRecords = filteredRecords.filter(record => {
            const projectName = record.projectId ? (projectsMap[record.projectId] || '') : 'Sin proyecto';
            const searchableValues = [
                record.interactionName,
                record.purpose,
                record.providerCompany,
                record.llmName,
                record.llmVersion,
                record.prompt,
                record.interactionLink,
                record.evidenceReference,
                record.ethicalNotes,
                record.biasNotes,
                record.observations,
                projectName,
                ...(Array.isArray(record.tags) ? record.tags : [])
            ];
            return searchableValues.some(value =>
                String(value || '').toLowerCase().includes(searchFilter)
            );
        });
    }
    if (projectFilter !== 'all') {
        if (projectFilter === 'none') {
            filteredRecords = filteredRecords.filter(record => !record.projectId);
        } else {
            filteredRecords = filteredRecords.filter(record => record.projectId === projectFilter);
        }
    }
    if (tagsFilter) {
        filteredRecords = filteredRecords.filter(record =>
            Array.isArray(record.tags) &&
            record.tags.some(tag => String(tag).trim().toLowerCase() === tagsFilter)
        );
    }
    if (qualityFilter !== 'all') {
        filteredRecords = filteredRecords.filter(record => {
            const quality = evaluateRecordQuality(record);
            if (qualityFilter === 'duplicate') return duplicateRecords.has(record.id);
            if (qualityFilter === 'important') return Boolean(record.isImportant);
            if (qualityFilter === 'no-project') return !record.projectId;
            return quality.status === qualityFilter;
        });
    }

    sortRecords(filteredRecords, sortBy, duplicateRecords);
    managementVisibleRecordIds = filteredRecords.map(record => record.id);
    managementSelectedRecords.forEach(recordId => {
        if (!managementVisibleRecordIds.includes(recordId)) managementSelectedRecords.delete(recordId);
    });
    updateManagementSelectionControls();

    const recordsByProject = { 'none': { name: 'Sin proyecto', records: [] } };
    projects.forEach(project => {
        recordsByProject[project.id] = { name: project.name, records: [] };
    });

    filteredRecords.forEach(record => {
        const projectId = record.projectId || 'none';
        if (recordsByProject[projectId]) {
            recordsByProject[projectId].records.push(record);
        } else {
            recordsByProject['none'].records.push(record);
        }
    });

    const recordsContainer = document.getElementById('records-by-project');
    recordsContainer.innerHTML = '';

    Object.keys(recordsByProject).forEach(projectId => {
        const projectGroup = recordsByProject[projectId];
        if (projectGroup.records.length === 0) return;
        const readyCount = projectGroup.records.filter(record =>
            evaluateRecordQuality(record).status === 'ready'
        ).length;

        const groupElement = document.createElement('div');
        groupElement.className = 'project-group';

        const headerElement = document.createElement('div');
        headerElement.className = 'project-header';
        headerElement.setAttribute('data-project-id', projectId);
        headerElement.setAttribute('role', 'button');
        headerElement.setAttribute('tabindex', '0');
        headerElement.setAttribute('aria-expanded', 'false');
        const recordsListId = `project-records-${String(projectId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        headerElement.setAttribute('aria-controls', recordsListId);
        headerElement.innerHTML = `
            <div class="project-name">${projectGroup.name}</div>
            <div class="project-count">${projectGroup.records.length} registros · ${readyCount} listos · ${projectGroup.records.length - readyCount} por revisar</div>
        `;
        const toggleProjectGroup = () => {
            const isExpanded = recordsListElement.classList.toggle('expanded');
            headerElement.setAttribute('aria-expanded', String(isExpanded));
        };
        headerElement.addEventListener('click', toggleProjectGroup);
        headerElement.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleProjectGroup();
            }
        });

        const recordsListElement = document.createElement('div');
        recordsListElement.className = 'project-records';
        recordsListElement.id = recordsListId;

        projectGroup.records.forEach(record => {
            recordsListElement.appendChild(createRecordElement(record, projectsMap, duplicateRecords));
        });

        groupElement.appendChild(headerElement);
        groupElement.appendChild(recordsListElement);
        recordsContainer.appendChild(groupElement);
    });

    if (recordsContainer.children.length === 0) {
        recordsContainer.innerHTML = '<div class="no-data-message">No hay registros que coincidan con los filtros aplicados</div>';
    }
}

function updateManagementSelectionControls() {
    const selectedCount = managementSelectedRecords.size;
    const visibleCount = managementVisibleRecordIds.length;
    const countLabel = document.getElementById('records-selection-count');
    const selectVisibleButton = document.getElementById('select-visible-records-btn');
    const clearButton = document.getElementById('clear-record-selection-btn');
    const importantButton = document.getElementById('mark-selected-important-btn');
    const deleteButton = document.getElementById('delete-selected-records-btn');

    countLabel.textContent = selectedCount === 1
        ? '1 registro seleccionado'
        : `${selectedCount} registros seleccionados`;
    selectVisibleButton.disabled = visibleCount === 0 || selectedCount === visibleCount;
    clearButton.disabled = selectedCount === 0;
    importantButton.disabled = selectedCount === 0;
    deleteButton.disabled = selectedCount === 0;
}

function setManagementRecordSelected(recordId, selected, recordElement = null) {
    if (selected) managementSelectedRecords.add(recordId);
    else managementSelectedRecords.delete(recordId);

    const row = recordElement || document.querySelector(`.record-row[data-record-id="${CSS.escape(recordId)}"]`);
    if (row) row.classList.toggle('is-selected', selected);
    updateManagementSelectionControls();
}

function selectVisibleManagementRecords() {
    managementVisibleRecordIds.forEach(recordId => managementSelectedRecords.add(recordId));
    document.querySelectorAll('.management-record-checkbox').forEach(checkbox => {
        checkbox.checked = true;
        checkbox.closest('.record-row')?.classList.add('is-selected');
    });
    updateManagementSelectionControls();
}

function clearManagementRecordSelection() {
    managementSelectedRecords.clear();
    document.querySelectorAll('.management-record-checkbox').forEach(checkbox => {
        checkbox.checked = false;
        checkbox.closest('.record-row')?.classList.remove('is-selected');
    });
    updateManagementSelectionControls();
}

async function markSelectedRecordsImportant() {
    const selectedIds = new Set(managementSelectedRecords);
    if (selectedIds.size === 0) return;

    const records = await loadFromStorage('chatlog_records') || [];
    let updatedCount = 0;
    const modifiedAt = new Date().toISOString();
    records.forEach(record => {
        if (selectedIds.has(record.id) && !record.isImportant) {
            record.isImportant = true;
            record.dateModified = modifiedAt;
            updatedCount += 1;
        }
    });

    if (updatedCount === 0) {
        showAppStatus('Los registros seleccionados ya estaban marcados como importantes.', 'info');
        return;
    }

    const saved = await saveToStorage('chatlog_records', records);
    if (saved) {
        clearManagementRecordSelection();
        await Promise.all([loadRecordsForManagement(), loadQuickAccessList()]);
        if (initializedTabs.has('stats')) await loadStatistics();
        showAppStatus(
            updatedCount === 1
                ? 'El registro seleccionado quedó marcado como importante.'
                : `${updatedCount} registros quedaron marcados como importantes.`
        );
    }
}

async function deleteSelectedRecords() {
    const selectedIds = new Set(managementSelectedRecords);
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmationText = count === 1
        ? '¿Deseas eliminar el registro seleccionado? Esta acción no se puede deshacer.'
        : `¿Deseas eliminar los ${count} registros seleccionados? Esta acción no se puede deshacer.`;
    if (!await appConfirm(confirmationText, {
        title: 'Eliminar registros',
        confirmLabel: 'Eliminar',
        danger: true
    })) return;

    const editingRecordId = document.getElementById('record-id').value;
    if (editingRecordId && selectedIds.has(editingRecordId)) {
        cancelRecordAutosave(true);
    }
    await recordAutosaveQueue.catch(() => {});

    const records = await loadFromStorage('chatlog_records') || [];
    const existingSelectedIds = new Set(
        records.filter(record => selectedIds.has(record.id)).map(record => record.id)
    );
    if (existingSelectedIds.size === 0) {
        clearManagementRecordSelection();
        showAppStatus('Los registros seleccionados ya no existen.', 'error');
        return;
    }

    const remainingRecords = records.filter(record => !existingSelectedIds.has(record.id));
    const saved = await saveToStorage('chatlog_records', remainingRecords);
    if (saved) {
        if (editingRecordId && existingSelectedIds.has(editingRecordId)) resetRecordForm();
        managementSelectedRecords.clear();

        const refreshTasks = [
            loadRecordsForManagement(),
            loadQuickAccessList(),
            updateAllTags(),
            loadProjectsForManagement()
        ];
        if (initializedTabs.has('declaration')) {
            refreshTasks.push(loadRecordsForDeclaration());
        }
        await Promise.all(refreshTasks);
        if (initializedTabs.has('stats')) await loadStatistics();

        const deletedCount = existingSelectedIds.size;
        showAppStatus(
            deletedCount === 1
                ? 'El registro seleccionado se eliminó correctamente.'
                : `${deletedCount} registros se eliminaron correctamente.`
        );
    }
}

function updateQualityFilterCardState(activeFilter) {
    document.querySelectorAll('.quality-filter-card').forEach(card => {
        card.setAttribute('aria-pressed', String(card.dataset.qualityFilter === activeFilter));
    });
}

async function showRecordsByQuality(qualityFilter) {
    const filterSelect = document.getElementById('records-quality-filter');
    filterSelect.value = qualityFilter;
    await loadRecordsForManagement();

    const recordsContainer = document.getElementById('records-by-project');
    recordsContainer.querySelectorAll('.project-group').forEach(group => {
        group.querySelector('.project-records').classList.add('expanded');
        group.querySelector('.project-header').setAttribute('aria-expanded', 'true');
    });

    recordsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstEditButton = recordsContainer.querySelector('.record-row .record-edit-btn');
    if (firstEditButton) firstEditButton.focus({ preventScroll: true });
    else showAppStatus('No hay registros que coincidan con este aviso.', 'info');
}

function createRecordElement(record, projectsMap, duplicateRecords) {
    const recordElement = document.createElement('div');
    recordElement.className = 'record-row';
    recordElement.setAttribute('data-record-id', record.id);
    recordElement.classList.toggle('is-selected', managementSelectedRecords.has(record.id));

    const selectionContainer = document.createElement('div');
    selectionContainer.className = 'record-selection';
    const selectionCheckbox = document.createElement('input');
    selectionCheckbox.type = 'checkbox';
    selectionCheckbox.className = 'management-record-checkbox';
    selectionCheckbox.checked = managementSelectedRecords.has(record.id);
    selectionCheckbox.setAttribute('aria-label', `Seleccionar registro: ${record.interactionName}`);
    selectionCheckbox.addEventListener('change', () => {
        setManagementRecordSelected(record.id, selectionCheckbox.checked, recordElement);
    });
    selectionContainer.appendChild(selectionCheckbox);

    const infoElement = document.createElement('div');
    infoElement.className = 'record-info';

    const nameElement = document.createElement('div');
    nameElement.className = 'record-name';
    if (record.isImportant) {
        const importantMarker = document.createElement('span');
        importantMarker.className = 'important-record-marker';
        importantMarker.textContent = 'Importante:';
        nameElement.appendChild(importantMarker);
    }
    nameElement.appendChild(document.createTextNode(record.interactionName || 'Borrador sin nombre'));

    if (record.rating && parseInt(record.rating) > 0) {
        const ratingSpan = document.createElement('span');
        ratingSpan.className = 'record-rating';
        ratingSpan.innerHTML = '★'.repeat(parseInt(record.rating));
        nameElement.appendChild(ratingSpan);
    }

    const detailsElement = document.createElement('div');
    detailsElement.className = 'record-details';
    const formattedDate = new Date(record.dateModified).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
    });
    const quality = evaluateRecordQuality(record);
    const issuesText = quality.issues.length > 0 ? `: ${quality.issues.join(', ')}` : '';
    const duplicateCount = duplicateRecords.get(record.id);
    const duplicateText = duplicateCount
        ? `; Posible duplicado: ${duplicateCount} registros coincidentes`
        : '';
    const priority = quality.status === 'incomplete'
        ? 'Crítica'
        : (duplicateCount ? 'Alta' : (quality.status === 'warning' ? 'Media' : 'Sin problemas'));
    detailsElement.textContent = `${record.llmName || 'Modelo no especificado'} - ${formattedDate} - Estado: ${quality.label} - Prioridad: ${priority}${issuesText}${duplicateText}`;

    infoElement.appendChild(nameElement);
    infoElement.appendChild(detailsElement);

    const actionsElement = document.createElement('div');
    actionsElement.className = 'record-actions';

    const detailPanelId = `record-detail-${String(record.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const detailBtn = document.createElement('button');
    detailBtn.className = 'edit-btn';
    detailBtn.textContent = 'Ver detalles';
    detailBtn.setAttribute('aria-expanded', 'false');
    detailBtn.setAttribute('aria-controls', detailPanelId);

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn record-edit-btn';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        editRecord(record.id);
    });

    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'edit-btn';
    duplicateBtn.textContent = 'Duplicar';
    duplicateBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        await duplicateRecord(record.id);
    });

    const moveBtn = document.createElement('button');
    moveBtn.className = 'edit-btn';
    moveBtn.textContent = 'Mover';
    moveBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        await moveRecordToProject(record.id);
    });

    const importantBtn = document.createElement('button');
    importantBtn.className = 'edit-btn important-btn';
    importantBtn.textContent = record.isImportant ? 'Quitar marca' : 'Marcar importante';
    importantBtn.setAttribute('aria-pressed', String(Boolean(record.isImportant)));
    importantBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        await toggleRecordImportance(record.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (await appConfirm(
            `¿Deseas eliminar el registro "${record.interactionName}"?`,
            { title: 'Eliminar registro', confirmLabel: 'Eliminar', danger: true }
        )) {
            await deleteRecord(record.id);
        }
    });

    const detailPanel = createRecordDetailPanel(record, projectsMap, detailPanelId);
    detailBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        const willOpen = detailPanel.hidden;
        detailPanel.hidden = !willOpen;
        detailBtn.setAttribute('aria-expanded', String(willOpen));
        detailBtn.textContent = willOpen ? 'Ocultar detalles' : 'Ver detalles';
    });

    actionsElement.appendChild(detailBtn);
    actionsElement.appendChild(editBtn);
    actionsElement.appendChild(duplicateBtn);
    actionsElement.appendChild(moveBtn);
    actionsElement.appendChild(importantBtn);
    actionsElement.appendChild(deleteBtn);
    recordElement.appendChild(selectionContainer);
    recordElement.appendChild(infoElement);
    recordElement.appendChild(actionsElement);
    recordElement.appendChild(detailPanel);

    return recordElement;
}

function createRecordDetailPanel(record, projectsMap, id) {
    const panel = document.createElement('div');
    panel.id = id;
    panel.className = 'record-detail-panel';
    panel.hidden = true;

    const detailList = document.createElement('dl');
    detailList.className = 'record-detail-list';
    const projectName = record.projectId
        ? (projectsMap[record.projectId] || 'Proyecto desconocido')
        : 'Sin proyecto';
    const model = `${record.llmName || 'Sin especificar'}${record.llmVersion ? ` (${record.llmVersion})` : ''}`;
    const details = [
        ['Proyecto', projectName],
        ['Finalidad', record.purpose || 'Sin especificar'],
        ['Fecha de interacción', record.interactionDate || 'Sin especificar'],
        ['Empresa proveedora', record.providerCompany || 'Sin especificar'],
        ['Modelo', model],
        [getEvidenceLabel(record), getEvidenceValue(record) || 'Sin especificar'],
        ['Prompt', record.prompt || 'Sin especificar'],
        ['Etiquetas', Array.isArray(record.tags) && record.tags.length > 0 ? record.tags.join(', ') : 'Sin etiquetas'],
        ['Etapa del trabajo', record.ethicalNotes || 'Sin especificar'],
        ['Verificación humana y responsabilidad', record.biasNotes || 'Sin especificar'],
        ['Observaciones', record.observations || 'Sin observaciones']
    ];

    details.forEach(([label, value]) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        detailList.appendChild(term);
        detailList.appendChild(description);
    });

    panel.appendChild(detailList);
    return panel;
}

function evaluateRecordQuality(record) {
    const requiredFields = [
        ['nombre de la interacción', record.interactionName],
        ['finalidad', record.purpose],
        ['modelo', record.llmName],
        ['prompt', record.prompt],
        [getEvidenceType(record) === 'local' ? 'referencia de evidencia' : 'liga de interacción', getEvidenceValue(record)]
    ];
    const recommendedFields = [];
    if (qualityRules.requireDate) recommendedFields.push(['fecha de interacción', record.interactionDate]);
    if (qualityRules.requireProvider) recommendedFields.push(['empresa proveedora', record.providerCompany]);
    if (qualityRules.requireStage) recommendedFields.push(['etapa del trabajo', record.ethicalNotes]);
    if (qualityRules.requireVerification) {
        recommendedFields.push(['verificación humana y responsabilidad', record.biasNotes]);
    }

    const missingValues = new Set(['sin nombre', 'sin especificar', 'importado desde csv']);
    const isMissingValue = value => {
        const normalized = String(value || '').trim().toLowerCase();
        return !normalized || missingValues.has(normalized);
    };

    const missingRequired = requiredFields
        .filter(([, value]) => isMissingValue(value))
        .map(([label]) => `falta ${label}`);
    if (
        getEvidenceType(record) === 'url' && !isMissingValue(record.interactionLink) &&
        !isValidInteractionLink(record.interactionLink)
    ) {
        missingRequired.push('liga de interacción no válida');
    }
    if (missingRequired.length > 0) {
        return { status: 'incomplete', label: 'Incompleto', issues: missingRequired };
    }

    const warnings = recommendedFields
        .filter(([, value]) => !String(value || '').trim())
        .map(([label]) => `falta ${label}`);
    if (qualityRules.requireProject && !record.projectId) warnings.push('sin proyecto');

    if (warnings.length > 0) {
        return { status: 'warning', label: 'Con advertencias', issues: warnings };
    }

    return { status: 'ready', label: 'Listo para declaración', issues: [] };
}

function normalizeDuplicateValue(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildDuplicateRecordMap(records) {
    const groups = new Map();

    records.forEach(record => {
        const interactionName = normalizeDuplicateValue(record.interactionName);
        const prompt = normalizeDuplicateValue(record.prompt);
        const evidence = normalizeDuplicateValue(getEvidenceValue(record));
        const interactionLink = evidence ? `${getEvidenceType(record)}:${evidence}` : '';
        if (!interactionName || (!prompt && !interactionLink)) return;

        const signature = [
            normalizeDuplicateValue(record.projectId),
            interactionName,
            normalizeDuplicateValue(record.purpose),
            normalizeDuplicateValue(record.interactionDate),
            normalizeDuplicateValue(record.providerCompany),
            normalizeDuplicateValue(record.llmName),
            normalizeDuplicateValue(record.llmVersion),
            prompt,
            interactionLink
        ].join('|');

        if (!groups.has(signature)) groups.set(signature, []);
        groups.get(signature).push(record.id);
    });

    const duplicates = new Map();
    groups.forEach(recordIds => {
        if (recordIds.length < 2) return;
        recordIds.forEach(recordId => duplicates.set(recordId, recordIds.length));
    });
    return duplicates;
}

function updateRecordsQualitySummary(records, duplicateRecords) {
    const summary = {
        total: records.length,
        incomplete: 0,
        warning: 0,
        ready: 0,
        duplicate: duplicateRecords.size
    };

    records.forEach(record => {
        summary[evaluateRecordQuality(record).status] += 1;
    });

    document.getElementById('quality-total-records').textContent = summary.total;
    document.getElementById('quality-incomplete-records').textContent = summary.incomplete;
    document.getElementById('quality-warning-records').textContent = summary.warning;
    document.getElementById('quality-ready-records').textContent = summary.ready;
    document.getElementById('quality-duplicate-records').textContent = summary.duplicate;
}

function buildImportReport(format, importedRecords, finalRecords, importedProjectCount = 0, skippedRecordCount = 0, skippedProjectCount = 0) {
    const qualityCounts = { incomplete: 0, warning: 0, ready: 0 };
    importedRecords.forEach(record => {
        qualityCounts[evaluateRecordQuality(record).status] += 1;
    });

    const importedIds = new Set(importedRecords.map(record => record.id));
    const duplicateRecords = buildDuplicateRecordMap(finalRecords);
    const importedDuplicates = Array.from(duplicateRecords.keys())
        .filter(recordId => importedIds.has(recordId))
        .length;
    const reviewCount = qualityCounts.incomplete + qualityCounts.warning;

    const lines = [
        `Importación ${format} completada.`,
        `Registros importados: ${importedRecords.length}.`,
        `Proyectos incorporados: ${importedProjectCount}.`
    ];
    if (skippedRecordCount > 0) lines.push(`Registros omitidos por ID existente: ${skippedRecordCount}.`);
    if (skippedProjectCount > 0) lines.push(`Proyectos omitidos por ID existente: ${skippedProjectCount}.`);
    lines.push(`Registros incompletos: ${qualityCounts.incomplete}.`);
    lines.push(`Registros con advertencias: ${qualityCounts.warning}.`);
    lines.push(`Posibles duplicados importados: ${importedDuplicates}.`);
    if (reviewCount > 0 || importedDuplicates > 0) {
        lines.push('Revisa estos casos en Herramientas > Revisión de registros.');
    }
    return lines.join('\n');
}

function sortRecords(records, sortBy, duplicateRecords = new Map()) {
    switch (sortBy) {
        case 'date-desc':
            records.sort((a, b) => new Date(b.dateModified) - new Date(a.dateModified)); break;
        case 'date-asc':
            records.sort((a, b) => new Date(a.dateModified) - new Date(b.dateModified)); break;
        case 'rating-desc':
            records.sort((a, b) => (parseInt(b.rating) || 0) - (parseInt(a.rating) || 0)); break;
        case 'rating-asc':
            records.sort((a, b) => (parseInt(a.rating) || 0) - (parseInt(b.rating) || 0)); break;
        case 'quality': {
            const getPriority = record => {
                const status = evaluateRecordQuality(record).status;
                if (status === 'incomplete') return 0;
                if (duplicateRecords.has(record.id)) return 1;
                if (status === 'warning') return 2;
                return 3;
            };
            records.sort((a, b) => {
                const difference = getPriority(a) - getPriority(b);
                return difference || new Date(b.dateModified) - new Date(a.dateModified);
            });
            break;
        }
        case 'important':
            records.sort((a, b) => {
                const importanceDifference = Number(Boolean(b.isImportant)) - Number(Boolean(a.isImportant));
                return importanceDifference || new Date(b.dateModified) - new Date(a.dateModified);
            });
            break;
        case 'name':
            records.sort((a, b) => a.interactionName.localeCompare(b.interactionName)); break;
    }
}

function editRecord(recordId) {
    document.querySelector('.tab-button[data-tab="main"]').click();
    loadRecordForEdit(recordId);
}

async function duplicateRecord(recordId) {
    const records = await loadFromStorage('chatlog_records') || [];
    const sourceRecord = records.find(record => record.id === recordId);
    if (!sourceRecord) {
        showAppStatus('No se pudo encontrar el registro para duplicarlo.', 'error');
        return;
    }

    const now = new Date().toISOString();
    const duplicatedRecord = {
        ...sourceRecord,
        id: generateUniqueId('record'),
        interactionName: `${sourceRecord.interactionName} (copia)`,
        isImportant: false,
        dateCreated: now,
        dateModified: now
    };
    records.push(duplicatedRecord);

    const saved = await saveToStorage('chatlog_records', records);
    if (saved) {
        await loadRecordsForManagement();
        await loadQuickAccessList();
        await updateAllTags();
        showAppStatus('Registro duplicado. Puedes editar la copia para completar sus cambios.');
    }
}

async function toggleRecordImportance(recordId) {
    const records = await loadFromStorage('chatlog_records') || [];
    const record = records.find(item => item.id === recordId);
    if (!record) {
        showAppStatus('No se pudo encontrar el registro.', 'error');
        return;
    }

    record.isImportant = !record.isImportant;
    record.dateModified = new Date().toISOString();
    const saved = await saveToStorage('chatlog_records', records);
    if (saved) {
        await Promise.all([loadRecordsForManagement(), loadQuickAccessList()]);
        showAppStatus(
            record.isImportant
                ? `El registro "${record.interactionName}" quedó marcado como importante.`
                : `Se quitó la marca de importancia de "${record.interactionName}".`
        );
    }
}

async function moveRecordToProject(recordId) {
    const [records, projects] = await Promise.all([
        loadFromStorage('chatlog_records'),
        loadFromStorage('chatlog_projects')
    ]);
    const safeRecords = records || [];
    const safeProjects = projects || [];
    const record = safeRecords.find(item => item.id === recordId);
    if (!record) {
        showAppStatus('No se pudo encontrar el registro para moverlo.', 'error');
        return;
    }

    const projectOptions = ['0. Sin proyecto']
        .concat(safeProjects.map((project, index) => `${index + 1}. ${project.name}`))
        .join('\n');
    const selection = prompt(
        `Escribe el número del proyecto de destino para "${record.interactionName}":\n\n${projectOptions}`,
        record.projectId
            ? String(safeProjects.findIndex(project => project.id === record.projectId) + 1)
            : '0'
    );
    if (selection === null) return;

    const selectedIndex = Number(selection);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > safeProjects.length) {
        showAppStatus('La selección no corresponde a un proyecto válido.', 'error');
        return;
    }

    record.projectId = selectedIndex === 0 ? null : safeProjects[selectedIndex - 1].id;
    record.dateModified = new Date().toISOString();
    const saved = await saveToStorage('chatlog_records', safeRecords);
    if (saved) {
        await loadRecordsForManagement();
        await loadQuickAccessList();
        showAppStatus('Registro movido correctamente.');
    }
}

async function deleteRecord(recordId) {
    if (document.getElementById('record-id').value === recordId) {
        cancelRecordAutosave(true);
    }
    await recordAutosaveQueue.catch(() => {});

    const records = await loadFromStorage('chatlog_records') || [];
    const recordToDelete = records.find(record => record.id === recordId);
    if (!recordToDelete) {
        showAppStatus('No se pudo encontrar el registro para eliminarlo.', 'error');
        return;
    }
    const filteredRecords = records.filter(record => record.id !== recordId);

    const saved = await saveToStorage('chatlog_records', filteredRecords);
    if (saved) {
        if (document.getElementById('record-id').value === recordId) resetRecordForm();

        const refreshTasks = [
            loadRecordsForManagement(),
            loadQuickAccessList(),
            updateAllTags(),
            loadProjectsForManagement()
        ];
        if (initializedTabs.has('declaration')) {
            refreshTasks.push(loadRecordsForDeclaration());
        }
        await Promise.all(refreshTasks);

        if (initializedTabs.has('stats')) await loadStatistics();
        showAppStatus(`El registro "${recordToDelete.interactionName}" se eliminó correctamente.`);
    }
}

// --- SISTEMA DE ETIQUETAS ---

async function initTagsSystem() {
    await updateAllTags();

    const tagsInput = document.getElementById('tags-input');
    const tagsSuggestions = document.getElementById('tags-suggestions');

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
    allTags = Array.from(tagsSet).sort();
}

function showTagSuggestions(input) {
    const suggestions = allTags.filter(tag =>
        tag.toLowerCase().includes(input.toLowerCase()) && !currentTags.includes(tag)
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

    if (!currentTags.includes(tag)) {
        currentTags.push(tag);
        updateTagsList();
        markRecordFormDirty();
        document.getElementById('tags').value = JSON.stringify(currentTags);
        if (!allTags.includes(tag)) {
            allTags.push(tag);
            allTags.sort();
        }
    }
}

function removeTag(tag) {
    const index = currentTags.indexOf(tag);
    if (index !== -1) {
        currentTags.splice(index, 1);
        updateTagsList();
        markRecordFormDirty();
        document.getElementById('tags').value = JSON.stringify(currentTags);
    }
}

function updateTagsList() {
    const tagsList = document.getElementById('tags-list');
    tagsList.innerHTML = '';

    currentTags.forEach(tag => {
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

// --- MANEJO DEL CAMPO "OTRO" EN FINALIDAD ---

function initOtherPurposeField() {
    const purposeSelect = document.getElementById('purpose');
    const otherContainer = document.getElementById('other-purpose-container');

    purposeSelect.addEventListener('change', function() {
        otherContainer.style.display = this.value === 'Otro' ? 'block' : 'none';
    });
}

// --- DECLARACIÓN DE USO ---
function getChatLogVersion() {
    return chrome.runtime?.getManifest?.().version || '2.0.1';
}

async function loadDeclarationProjects() {
    const projects = await loadFromStorage('chatlog_projects') || [];
    const declarationProjectSelect = document.getElementById('declaration-project-select');

    const defaultOptions = Array.from(declarationProjectSelect.options).slice(0, 2);
    declarationProjectSelect.innerHTML = '';
    defaultOptions.forEach(option => declarationProjectSelect.appendChild(option));

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        declarationProjectSelect.appendChild(option);
    });
}

async function loadRecordsForDeclaration() {
    const records = await loadFromStorage('chatlog_records') || [];
    const noRecordsMessage = document.getElementById('no-declaration-records-message');
    const recordsList = document.getElementById('records-list');

    if (records.length === 0) {
        selectedRecords = [];
        noRecordsMessage.style.display = 'block';
        recordsList.innerHTML = '';
        return;
    }

    noRecordsMessage.style.display = 'none';
    selectedRecords = retainValidRecordSelection(selectedRecords, records);
    await filterRecordsForDeclaration();
}

async function filterRecordsForDeclaration() {
    const projectFilter = document.getElementById('declaration-project-select').value;
    let records = await loadFromStorage('chatlog_records') || [];

    if (projectFilter !== 'all') {
        if (projectFilter === 'none') {
            records = records.filter(record => !record.projectId);
        } else {
            records = records.filter(record => record.projectId === projectFilter);
        }
    }

    records.sort((a, b) => {
        const projectA = a.projectId || 'zzz';
        const projectB = b.projectId || 'zzz';
        if (projectA !== projectB) return projectA.localeCompare(projectB);
        return new Date(b.dateModified) - new Date(a.dateModified);
    });

    const recordsList = document.getElementById('records-list');
    const noRecordsMessage = document.getElementById('no-declaration-records-message');

    if (records.length === 0) {
        noRecordsMessage.style.display = 'block';
        recordsList.innerHTML = '';
        return;
    }

    noRecordsMessage.style.display = 'none';
    recordsList.innerHTML = '';

    const projects = await loadFromStorage('chatlog_projects') || [];
    const projectsMap = {};
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    records.forEach(record => {
        const recordItem = document.createElement('div');
        recordItem.className = 'record-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'record-checkbox';
        checkbox.value = record.id;
        checkbox.checked = selectedRecords.includes(record.id);
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                if (!selectedRecords.includes(record.id)) selectedRecords.push(record.id);
            } else {
                const index = selectedRecords.indexOf(record.id);
                if (index !== -1) selectedRecords.splice(index, 1);
            }
        });

        const recordInfo = document.createElement('div');
        recordInfo.className = 'record-info';

        const recordTitle = document.createElement('div');
        recordTitle.className = 'record-title';

        if (record.rating && parseInt(record.rating) > 0) {
            const titleText = document.createElement('span');
            titleText.textContent = record.interactionName;
            const ratingSpan = document.createElement('span');
            ratingSpan.innerHTML = '&nbsp;' + '★'.repeat(parseInt(record.rating));
            ratingSpan.style.color = 'var(--star-active)';
            ratingSpan.style.fontSize = '0.9em';
            recordTitle.appendChild(titleText);
            recordTitle.appendChild(ratingSpan);
        } else {
            recordTitle.textContent = record.interactionName;
        }

        const recordDetails = document.createElement('div');
        recordDetails.className = 'record-details';
        const formattedDate = new Date(record.dateModified).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        });
        const projectName = (record.projectId && projectsMap[record.projectId])
            ? projectsMap[record.projectId]
            : 'Sin proyecto';
        recordDetails.textContent = `${record.llmName} (${record.purpose}) - ${formattedDate} - ${projectName}`;

        recordInfo.appendChild(recordTitle);
        recordInfo.appendChild(recordDetails);
        recordItem.appendChild(checkbox);
        recordItem.appendChild(recordInfo);
        recordsList.appendChild(recordItem);
    });
}

function selectAllRecords() {
    document.querySelectorAll('.record-checkbox').forEach(checkbox => {
        checkbox.checked = true;
        if (!selectedRecords.includes(checkbox.value)) selectedRecords.push(checkbox.value);
    });
}

function deselectAllRecords() {
    document.querySelectorAll('.record-checkbox').forEach(checkbox => { checkbox.checked = false; });
    selectedRecords = [];
}

function applyRecommendedDeclarationFormat() {
    const workType = document.getElementById('declaration-work-type').value;
    const recommendation = document.getElementById('declaration-format-recommendation');
    if (!workType) {
        recommendation.textContent = 'Puedes elegir directamente un formato o indicar el tipo de trabajo.';
        return;
    }

    const formatSelect = document.getElementById('declaration-format');
    const formatNames = {
        apa: 'Estilo APA',
        elsevier: 'Estilo Elsevier',
        aid: 'Estilo AID Framework',
        detailed: 'Detallado',
        minimal: 'Mínimo'
    };
    formatSelect.value = workType;
    recommendation.textContent = `Formato recomendado y seleccionado: ${formatNames[workType]}.`;
    updateDeclarationFormatGuidance();
}

function updateDeclarationFormatGuidance() {
    const format = document.getElementById('declaration-format').value;
    const guidanceByFormat = {
        standard: 'Resumen general organizado por proyecto, con los datos seleccionados para cada interacción.',
        detailed: 'Formato ampliado con trazabilidad de modelos, finalidades, etiquetas, prompts y notas.',
        minimal: 'Constancia breve del número de interacciones, modelos y finalidades.',
        apa: 'Incluye autoría, institución, modelo, proveedor, fecha, finalidad, etapa, prompt y enlace o referencia de evidencia.',
        elsevier: 'Declaración editorial breve sobre la herramienta, su finalidad y la responsabilidad de autoría.',
        aid: 'Incluye herramienta, fecha, propósito, prompt, contribución humana, verificación y registro de interacción.'
    };

    document.getElementById('declaration-format-guidance').textContent = guidanceByFormat[format] || '';
}

function quotePrompt(promptText) {
    const trimmedPrompt = String(promptText || '').trim();
    const unwrappedPrompt = trimmedPrompt.replace(/^["“”]+|["“”]+$/g, '').trim();
    return `“${unwrappedPrompt}”`;
}

function formatInteractionDate(interactionDate, options) {
    if (!interactionDate) return 'Sin especificar';

    const parsedDate = new Date(`${interactionDate}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) return interactionDate;

    return parsedDate.toLocaleDateString(undefined, options);
}

function isMissingRecordValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return !normalized || ['sin nombre', 'sin especificar', 'importado desde csv'].includes(normalized);
}

function validateDeclarationRecords(records, format, options) {
    const issues = new Set();
    const duplicateRecords = buildDuplicateRecordMap(records);
    const addIssue = (record, label) => {
        issues.add(`- ${record.interactionName || 'Registro sin nombre'}: falta ${label}.`);
    };

    if (format === 'apa') {
        if (!options.researcherName) issues.add('- Datos de autoría: falta el nombre del investigador o estudiante.');
        if (!options.institutionName) issues.add('- Datos de autoría: falta la institución.');
    }

    records.forEach(record => {
        if (isMissingRecordValue(record.interactionName)) addIssue(record, 'nombre de la interacción');
        if (isMissingRecordValue(record.purpose)) addIssue(record, 'finalidad');
        if (isMissingRecordValue(record.llmName)) addIssue(record, 'nombre del LLM');

        if (
            (format === 'apa' || format === 'aid' || options.includePrompts) &&
            isMissingRecordValue(record.prompt)
        ) {
            addIssue(record, 'prompt');
        }
        if (
            (format === 'apa' || format === 'aid' || options.includeLinks) &&
            isMissingRecordValue(getEvidenceValue(record))
        ) {
            addIssue(record, getEvidenceType(record) === 'local' ? 'referencia de evidencia' : 'liga de interacción');
        } else if (
            (format === 'apa' || format === 'aid' || options.includeLinks) &&
            getEvidenceType(record) === 'url' && !isValidInteractionLink(record.interactionLink)
        ) {
            issues.add(`- ${record.interactionName || 'Registro sin nombre'}: la liga de interacción no es válida.`);
        }
        if (
            (format === 'apa' || format === 'aid' || qualityRules.requireDate) &&
            isMissingRecordValue(record.interactionDate)
        ) {
            addIssue(record, 'fecha de interacción');
        }
        if (
            (format === 'apa' || qualityRules.requireProvider) &&
            isMissingRecordValue(record.providerCompany)
        ) {
            addIssue(record, 'empresa proveedora');
        }
        if (
            (format === 'apa' || qualityRules.requireStage) &&
            isMissingRecordValue(record.ethicalNotes)
        ) {
            addIssue(record, 'etapa del trabajo');
        }
        if (qualityRules.requireVerification && isMissingRecordValue(record.biasNotes)) {
            addIssue(record, 'verificación humana y responsabilidad');
        }
        if (qualityRules.requireProject && !record.projectId) {
            issues.add(`- ${record.interactionName || 'Registro sin nombre'}: no está asignado a un proyecto.`);
        }
        if (duplicateRecords.has(record.id)) {
            issues.add(`- ${record.interactionName || 'Registro sin nombre'}: posible registro duplicado.`);
        }
    });

    return Array.from(issues);
}

async function generateDeclaration() {
    if (selectedRecords.length === 0) {
        showAppStatus('Selecciona al menos un registro para incluir en la declaración.', 'error');
        return;
    }

    const format = document.getElementById('declaration-format').value;
    const researcherName = document.getElementById('researcher-name').value.trim();
    const institutionName = document.getElementById('institution-name').value.trim();
    const includePrompts = document.getElementById('include-prompts').checked;
    const includeLinks = document.getElementById('include-links').checked;
    const includeDates = document.getElementById('include-dates').checked;

    const allRecords = await loadFromStorage('chatlog_records') || [];
    const projects = await loadFromStorage('chatlog_projects') || [];
    const projectsMap = {};
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    const recordsToInclude = allRecords
        .filter(record => selectedRecords.includes(record.id))
        .sort((a, b) => {
            const pA = a.projectId || 'zzz';
            const pB = b.projectId || 'zzz';
            if (pA !== pB) return pA.localeCompare(pB);
            return new Date(a.dateModified) - new Date(b.dateModified);
        });

    await loadQualityReviewSettings();
    const validationIssues = validateDeclarationRecords(recordsToInclude, format, {
        researcherName,
        institutionName,
        includePrompts,
        includeLinks
    });
    if (validationIssues.length > 0) {
        const visibleIssues = validationIssues.slice(0, 12);
        const remainingIssues = validationIssues.length - visibleIssues.length;
        const remainingText = remainingIssues > 0
            ? `\n... y ${remainingIssues} observaciones adicionales.`
            : '';
        const shouldContinue = await appConfirm(
            `Revisa estas recomendaciones antes de generar la declaración:\n\n${visibleIssues.join('\n')}${remainingText}\n\n¿Deseas generar la declaración de todos modos?`,
            { title: 'Revisión de la declaración', confirmLabel: 'Generar de todos modos' }
        );
        if (!shouldContinue) return;
    }

    let declarationText = '';

    switch (format) {
        case 'standard':
            declarationText += '== DECLARACIÓN DE USO DE MODELOS DE LENGUAJE ==\n\n';
            if (researcherName) declarationText += `Investigador/a: ${researcherName}\n`;
            if (institutionName) declarationText += `Institución: ${institutionName}\n`;
            declarationText += `Fecha de la declaración: ${new Date().toLocaleDateString()}\n\n`;
            declarationText += `Esta declaración detalla el uso de modelos de lenguaje (LLMs) en el proceso de investigación. Se incluyen ${recordsToInclude.length} interacciones con LLMs.\n\n`;
            break;

        case 'detailed':
            declarationText += '===============================================================\n';
            declarationText += '      DECLARACIÓN DETALLADA DE USO DE MODELOS DE LENGUAJE      \n';
            declarationText += '===============================================================\n\n';
            if (researcherName || institutionName) {
                declarationText += 'INFORMACIÓN DEL INVESTIGADOR\n-----------------------------\n';
                if (researcherName) declarationText += `Nombre: ${researcherName}\n`;
                if (institutionName) declarationText += `Institución: ${institutionName}\n`;
                declarationText += '\n';
            }
            declarationText += 'RESUMEN DE INTERACCIONES\n------------------------\n';
            declarationText += `Total de interacciones documentadas: ${recordsToInclude.length}\n`;
            const uniqueModels = new Set(recordsToInclude.map(r => r.llmName + (r.llmVersion ? ` ${r.llmVersion}` : '')));
            declarationText += `Modelos utilizados: ${uniqueModels.size}\n`;
            declarationText += 'Modelos: ' + Array.from(uniqueModels).join(', ') + '\n\n';
            const uniquePurposes = new Set(recordsToInclude.map(r => r.purpose));
            declarationText += `Finalidades: ${Array.from(uniquePurposes).join(', ')}\n\n`;
            declarationText += `Fecha de la declaración: ${new Date().toLocaleDateString()}\n\n`;
            declarationText += '===============================================================\n\n';
            break;

        case 'minimal':
            declarationText += 'DECLARACIÓN DE USO DE LLMs\n\n';
            if (researcherName) declarationText += `Por: ${researcherName}\n`;
            if (institutionName) declarationText += `${institutionName}\n`;
            declarationText += `${new Date().toLocaleDateString()}\n\n`;
            declarationText += `Se utilizaron modelos de lenguaje en ${recordsToInclude.length} ocasiones durante el proceso de investigación.\n\n`;
            break;

        case 'apa':
            if (recordsToInclude.length > 1) {
                const apaResearcher = researcherName || '[Nombre del investigador/estudiante]';
                const apaInstitution = institutionName || '[Institución]';
                declarationText += `Yo ${apaResearcher} estudiante o académicX de la ${apaInstitution} declaro que utilicé las siguientes herramientas de inteligencia artificial:\n\n`;
            }
            break;

        case 'elsevier':
            if (recordsToInclude.length > 1) {
                declarationText += 'En la preparación de este trabajo, el autor/autora usó las siguientes herramientas de inteligencia artificial:\n\n';
            }
            break;

        case 'aid':
            declarationText += 'Declaración de uso de inteligencia artificial (AID Framework)\n\n';
            break;
    }

    let currentProject = null;

    recordsToInclude.forEach((record, index) => {
        if ((format === 'detailed' || format === 'standard') && record.projectId !== currentProject) {
            currentProject = record.projectId;
            if (index > 0) declarationText += '\n';
            declarationText += '---\n\n';
            declarationText += `PROYECTO: ${record.projectId ? projectsMap[record.projectId] : 'Sin proyecto asignado'}\n\n`;
        }

        switch (format) {
            case 'standard':
                declarationText += `${index + 1}. ${record.interactionName}`;
                if (record.rating && parseInt(record.rating) > 0) declarationText += ` (Calificación: ${record.rating}/5)`;
                declarationText += '\n';
                declarationText += `   Modelo: ${record.llmName}${record.llmVersion ? ` (${record.llmVersion})` : ''}\n`;
                declarationText += `   Finalidad: ${record.purpose}\n`;
                if (includeDates) declarationText += `   Fecha: ${formatInteractionDate(record.interactionDate)}\n`;
                if (includePrompts) declarationText += `   Prompt: ${quotePrompt(record.prompt)}\n`;
                if (includeLinks && getEvidenceValue(record)) declarationText += `   ${getEvidenceLabel(record)}: ${getEvidenceValue(record)}\n`;
                if (record.ethicalNotes) declarationText += `   Etapa del trabajo: ${record.ethicalNotes}\n`;
                if (record.biasNotes) declarationText += `   Verificación humana y responsabilidad: ${record.biasNotes}\n`;
                declarationText += '\n';
                break;

            case 'detailed':
                declarationText += `INTERACCIÓN #${index + 1}: ${record.interactionName}`;
                if (record.rating && parseInt(record.rating) > 0) declarationText += ` (Calificación: ${record.rating}/5)`;
                declarationText += '\n';
                declarationText += `------------------------${'-'.repeat(record.interactionName.length)}\n`;
                declarationText += `Modelo: ${record.llmName}${record.llmVersion ? ` (${record.llmVersion})` : ''}\n`;
                declarationText += `Finalidad: ${record.purpose}\n`;
                if (includeDates) {
                    declarationText += `Fecha: ${formatInteractionDate(record.interactionDate, {
                        year: 'numeric', month: 'long', day: 'numeric'
                    })}\n`;
                }
                if (record.tags && record.tags.length > 0) declarationText += `Etiquetas: ${record.tags.join(', ')}\n`;
                if (includeLinks && getEvidenceValue(record)) declarationText += `${getEvidenceLabel(record)}: ${getEvidenceValue(record)}\n`;
                if (includePrompts) {
                    declarationText += '\nPROMPT UTILIZADO:\n----------------\n';
                    declarationText += `${quotePrompt(record.prompt)}\n`;
                }
                if (record.ethicalNotes || record.biasNotes || record.observations) {
                    declarationText += '\nNOTAS ADICIONALES:\n-----------------\n';
                    if (record.ethicalNotes) declarationText += `Etapa del trabajo: ${record.ethicalNotes}\n`;
                    if (record.biasNotes) declarationText += `Verificación humana y responsabilidad: ${record.biasNotes}\n`;
                    if (record.observations) declarationText += `Observaciones: ${record.observations}\n`;
                }
                declarationText += '\n';
                break;

            case 'minimal':
                declarationText += `- ${record.interactionName}: ${record.llmName}${record.llmVersion ? ` (${record.llmVersion})` : ''} - ${record.purpose}`;
                if (record.rating && parseInt(record.rating) > 0) declarationText += ` (${record.rating}/5)`;
                declarationText += '\n';
                break;

            case 'apa': {
                const apaResearcher = researcherName || '[Nombre del investigador/estudiante]';
                const apaInstitution = institutionName || '[Institución]';
                const apaModel = `${record.llmName || '[Nombre del LLM]'}${record.llmVersion ? ` ${record.llmVersion}` : ''}`;
                const apaProvider = record.providerCompany || '[Empresa proveedora]';
                const apaPurpose = record.purpose || '[finalidad de la interacción]';
                const apaStage = record.ethicalNotes || '[etapa del trabajo]';
                const apaPrompt = record.prompt || '[prompt]';
                const apaLink = getEvidenceValue(record) || '[referencia de la interacción]';
                const apaQuotedPrompt = quotePrompt(apaPrompt);
                const apaPromptSeparator = /[.!?]$/.test(apaPrompt.trim()) ? ' ' : '. ';
                let apaDate = '[fecha de interacción]';

                if (record.interactionDate) {
                    const parsedDate = new Date(`${record.interactionDate}T00:00:00`);
                    if (!Number.isNaN(parsedDate.getTime())) {
                        apaDate = parsedDate.toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                    }
                }

                if (recordsToInclude.length > 1) {
                    declarationText += `${index + 1}. ${apaModel} de ${apaProvider} (${apaDate}). Finalidad de la interacción: ${apaPurpose}. Uso en el trabajo: generar ideas o borradores de ${apaStage}. Prompt utilizado: ${apaQuotedPrompt}${apaPromptSeparator}${getEvidenceLabel(record)}: ${apaLink}.`;
                } else {
                    declarationText += `Yo ${apaResearcher} estudiante o académicX de la ${apaInstitution} declaro que utilicé ${apaModel} de ${apaProvider} (${apaDate}) para ${apaPurpose} y generar ideas o borradores de ${apaStage}. El prompt utilizado fue ${apaQuotedPrompt}${apaPromptSeparator}${getEvidenceLabel(record)}: ${apaLink}.`;
                }
                declarationText += '\n\n';
                break;
            }

            case 'elsevier': {
                const elsevierModel = `${record.llmName || '[Nombre del LLM]'}${record.llmVersion ? ` ${record.llmVersion}` : ''}`;
                const elsevierPurpose = record.purpose || '[finalidad de la interacción]';

                if (recordsToInclude.length > 1) {
                    declarationText += `${index + 1}. ${elsevierModel} para ${elsevierPurpose}.`;
                } else {
                    declarationText += `En la preparación de este trabajo, el autor/autora usó ${elsevierModel} para ${elsevierPurpose}.`;
                }
                declarationText += '\n\n';
                break;
            }

            case 'aid': {
                const aidModel = `${record.llmName || '[Nombre del LLM]'}${record.llmVersion ? ` ${record.llmVersion}` : ''}`;
                const aidPurpose = record.purpose || '[propósito del uso]';
                const aidPrompt = record.prompt || '[Prompt]';
                const aidLink = `${getEvidenceLabel(record)}: ${getEvidenceValue(record) || '[referencia de la interacción]'}`;
                const aidPromptText = aidPrompt.trim();
                const aidPromptStatement = /[.!?]$/.test(aidPromptText)
                    ? quotePrompt(aidPromptText)
                    : `${quotePrompt(aidPromptText)}.`;
                let aidDate = '[Fecha de la interacción]';

                if (record.interactionDate) {
                    const parsedDate = new Date(`${record.interactionDate}T00:00:00`);
                    if (!Number.isNaN(parsedDate.getTime())) {
                        aidDate = parsedDate.toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                    }
                }

                if (recordsToInclude.length > 1) {
                    declarationText += `${index + 1}.\n`;
                }
                declarationText += `Herramienta(s) utilizada y fecha(s): ${aidModel}. ${aidDate}\n`;
                declarationText += `Propósito del uso: ${aidPurpose}. (p.e. Apoyo en la conceptualización del estudio y revisión preliminar de la pregunta de investigación).\n\n`;
                declarationText += `Interacción realizada: ${aidPromptStatement}\n\n`;
                declarationText += 'Contribución humana: (p.e. La formulación original de la pregunta de investigación, la selección del problema de estudio, la interpretación de las sugerencias y la decisión final sobre la redacción correspondieron íntegramente a la persona autora).\n\n';
                declarationText += 'Verificación y revisión: Todas las recomendaciones generadas fueron evaluadas críticamente y contrastadas con la literatura especializada y los objetivos del proyecto antes de su incorporación.\n\n';
                declarationText += `Registro de interacción: ${aidLink}\n\n`;
                break;
            }
        }
    });

    if (format === 'standard' || format === 'detailed') {
        declarationText += '\n===========\n';
        declarationText += `Esta declaración fue generada automáticamente utilizando ChatLog, versión ${getChatLogVersion()}.\n`;
    } else if (format === 'apa') {
        declarationText += 'Asumo toda la responsabilidad por el contenido de este proyecto/trabajo/ensayo de investigación.\n\n';
        declarationText += '*Nota: APA recomienda ubicar la declaración de uso en la sección de Métodos o metodología, o en una sección comparable del artículo. Para revisiones de literatura u otros tipos de ensayos, puede describirse su uso en la introducción.\n';
    } else if (format === 'elsevier') {
        declarationText += 'Después de usar esta herramienta, el autor/autora revisó y editó el contenido según fuera necesario y toma total responsabilidad del contenido del artículo publicado.\n\n';
        declarationText += '*Nota: Elsevier solicita que el texto sea colocado en una sección nueva titulada “Declaración de IA generativa y tecnológicas asistidas por IA en el proceso de escritura”, al final del manuscrito y justo antes de las referencias bibliográficas.\n';
    }

    renderDeclarationPreview(declarationText, format);
}

function renderDeclarationPreview(declarationText, format) {
    const preview = document.getElementById('declaration-preview');

    if (format !== 'aid') {
        preview.textContent = declarationText;
        return;
    }

    const graySegments = [
        '(p.e. Apoyo en la conceptualización del estudio y revisión preliminar de la pregunta de investigación).',
        '(p.e. La formulación original de la pregunta de investigación, la selección del problema de estudio, la interpretación de las sugerencias y la decisión final sobre la redacción correspondieron íntegramente a la persona autora).'
    ];
    const fragment = document.createDocumentFragment();
    let remainingText = declarationText;

    while (remainingText) {
        let nextSegment = null;
        let nextIndex = -1;

        graySegments.forEach(segment => {
            const segmentIndex = remainingText.indexOf(segment);
            if (segmentIndex !== -1 && (nextIndex === -1 || segmentIndex < nextIndex)) {
                nextSegment = segment;
                nextIndex = segmentIndex;
            }
        });

        if (nextIndex === -1) {
            fragment.appendChild(document.createTextNode(remainingText));
            break;
        }

        fragment.appendChild(document.createTextNode(remainingText.slice(0, nextIndex)));
        const example = document.createElement('span');
        example.className = 'aid-example-text';
        example.textContent = nextSegment;
        fragment.appendChild(example);
        remainingText = remainingText.slice(nextIndex + nextSegment.length);
    }

    preview.replaceChildren(fragment);
}

function copyDeclarationToClipboard() {
    const declarationText = document.getElementById('declaration-preview').textContent;

    if (!declarationText || declarationText === 'La declaración se mostrará aquí después de generarla.') {
        showAppStatus('No hay declaración para copiar. Genera una declaración primero.', 'error');
        return;
    }

    navigator.clipboard.writeText(declarationText)
        .then(() => showAppStatus('Declaración copiada al portapapeles.'))
        .catch(err => {
            showAppStatus('Error al copiar la declaración.', 'error');
            console.error('Error al copiar al portapapeles:', err);
        });
}

function downloadDeclaration() {
    const declarationText = document.getElementById('declaration-preview').textContent;

    if (!declarationText || declarationText === 'La declaración se mostrará aquí después de generarla.') {
        showAppStatus('No hay declaración para descargar. Genera una declaración primero.', 'error');
        return;
    }

    const blob = new Blob([declarationText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename = `declaracion_llm_${new Date().toISOString().split('T')[0]}.txt`;

    chrome.downloads.download({ url, filename, saveAs: false }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error al descargar declaración:', chrome.runtime.lastError);
            showAppStatus('Error al descargar la declaración.', 'error');
        }
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

// --- ESTADÍSTICAS ---

async function loadStatistics() {
    const { records, projects } = await getStatisticsData();
    populateStatisticsFilters(records, projects);
    records.length === 0 ? showNoStatsData() : updateStatistics(records, projects);
}

async function getStatisticsData() {
    if (statisticsDataCache?.revision === storageRevision) {
        return statisticsDataCache;
    }

    const [records, projects] = await Promise.all([
        loadFromStorage('chatlog_records'),
        loadFromStorage('chatlog_projects')
    ]);
    statisticsDataCache = {
        revision: storageRevision,
        records: records || [],
        projects: projects || []
    };
    return statisticsDataCache;
}

function populateStatisticsFilters(records, projects) {
    const projectFilter = document.getElementById('stats-project-filter');

    const allOption = projectFilter.options[0];
    projectFilter.innerHTML = '';
    projectFilter.appendChild(allOption);

    const noneOption = document.createElement('option');
    noneOption.value = 'none';
    noneOption.textContent = 'Sin proyecto';
    projectFilter.appendChild(noneOption);

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projectFilter.appendChild(option);
    });

    const uniqueModels = new Set(records.map(r => r.llmName));

    const modelFilter = document.getElementById('stats-model-filter');
    const allModelOption = modelFilter.options[0];
    modelFilter.innerHTML = '';
    modelFilter.appendChild(allModelOption);

    Array.from(uniqueModels).sort().forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelFilter.appendChild(option);
    });
}

async function applyStatisticsFilters() {
    const dateRange = document.getElementById('stats-date-range').value;
    const projectFilter = document.getElementById('stats-project-filter').value;
    const modelFilter = document.getElementById('stats-model-filter').value;

    const statsData = await getStatisticsData();
    let records = statsData.records;

    if (dateRange !== 'all') {
        const currentDate = new Date();
        let startDate = new Date(currentDate);
        if (dateRange === 'month') startDate.setMonth(currentDate.getMonth() - 1);
        else if (dateRange === 'quarter') startDate.setMonth(currentDate.getMonth() - 3);
        else if (dateRange === 'year') startDate.setFullYear(currentDate.getFullYear() - 1);
        records = records.filter(record => new Date(record.dateCreated) >= startDate);
    }

    if (projectFilter !== 'all') {
        records = projectFilter === 'none'
            ? records.filter(record => !record.projectId)
            : records.filter(record => record.projectId === projectFilter);
    }

    if (modelFilter !== 'all') {
        records = records.filter(record => record.llmName === modelFilter);
    }

    records.length === 0 ? showNoStatsData() : updateStatistics(records, statsData.projects);
}

async function resetStatisticsFilters() {
    document.getElementById('stats-date-range').value = 'all';
    document.getElementById('stats-project-filter').value = 'all';
    document.getElementById('stats-model-filter').value = 'all';

    const { records, projects } = await getStatisticsData();
    records.length === 0 ? showNoStatsData() : updateStatistics(records, projects);
}

function showNoStatsData() {
    ['total-interactions', 'total-models', 'total-projects', 'total-purposes'].forEach(id => {
        document.getElementById(id).textContent = '0';
    });
    ['models-table', 'purposes-table', 'projects-table'].forEach(tableId => {
        document.querySelector(`#${tableId} tbody`).innerHTML =
            `<tr><td colspan="4" class="no-data-message">No hay datos disponibles</td></tr>`;
    });
    document.querySelector('#models-by-project-table tbody').innerHTML =
        '<tr><td colspan="3" class="no-data-message">No hay datos disponibles</td></tr>';
    document.querySelector('#tag-pairs-table tbody').innerHTML =
        '<tr><td colspan="2" class="no-data-message">No hay coincidencias disponibles</td></tr>';
    document.getElementById('timeline-container').innerHTML = '<div class="no-data-message">No hay datos disponibles</div>';
    document.getElementById('tags-cloud').innerHTML = '<div class="no-data-message">No hay etiquetas disponibles</div>';
}

function updateStatistics(records, projects) {
    const aggregates = aggregateStatistics(records, projects);
    updateStatsSummary(records, aggregates);
    updateModelsTable(aggregates.modelCounts, records.length);
    updatePurposesTable(aggregates.purposeCounts, records.length);
    updateProjectsTable(aggregates.projectCounts, records.length);
    updateTimeline(aggregates.recordsByDate);
    updateModelsByProjectTable(aggregates.modelProjectCounts);
    updateTagPairsTable(aggregates.tagPairCounts);
    updateTagsCloud(aggregates.tagCounts);
}

function aggregateStatistics(records, projects) {
    const projectsMap = {};
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    const modelCounts = {};
    const purposeCounts = {};
    const projectCounts = {};
    const recordsByDate = {};
    const tagCounts = {};
    const modelProjectCounts = {};
    const tagPairCounts = {};
    const projectIds = new Set();

    records.forEach(record => {
        modelCounts[record.llmName] = (modelCounts[record.llmName] || 0) + 1;
        purposeCounts[record.purpose] = (purposeCounts[record.purpose] || 0) + 1;

        if (record.projectId) projectIds.add(record.projectId);
        const projectName = record.projectId
            ? (projectsMap[record.projectId] || 'Proyecto desconocido')
            : 'Sin proyecto';
        projectCounts[projectName] = (projectCounts[projectName] || 0) + 1;
        const modelProjectKey = `${projectName}\u0000${record.llmName || 'Modelo no especificado'}`;
        modelProjectCounts[modelProjectKey] = (modelProjectCounts[modelProjectKey] || 0) + 1;

        const dateKey = new Date(record.dateCreated).toISOString().split('T')[0];
        recordsByDate[dateKey] = (recordsByDate[dateKey] || 0) + 1;

        if (Array.isArray(record.tags)) {
            const uniqueTags = Array.from(new Set(record.tags.map(tag => String(tag).trim()).filter(Boolean)))
                .sort((a, b) => a.localeCompare(b, 'es'));
            uniqueTags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
            for (let firstIndex = 0; firstIndex < uniqueTags.length; firstIndex += 1) {
                for (let secondIndex = firstIndex + 1; secondIndex < uniqueTags.length; secondIndex += 1) {
                    const pairKey = `${uniqueTags[firstIndex]}\u0000${uniqueTags[secondIndex]}`;
                    tagPairCounts[pairKey] = (tagPairCounts[pairKey] || 0) + 1;
                }
            }
        }
    });

    return {
        modelCounts,
        purposeCounts,
        projectCounts,
        recordsByDate,
        tagCounts,
        modelProjectCounts,
        tagPairCounts,
        projectCount: projectIds.size
    };
}

function updateStatsSummary(records, aggregates) {
    document.getElementById('total-interactions').textContent = records.length;
    document.getElementById('total-models').textContent = Object.keys(aggregates.modelCounts).length;
    document.getElementById('total-projects').textContent = aggregates.projectCount;
    document.getElementById('total-purposes').textContent = Object.keys(aggregates.purposeCounts).length;
}

function buildTableWithBars(tableId, countMap, total, colors) {
    const sorted = Object.keys(countMap).sort((a, b) => countMap[b] - countMap[a]);
    const tableBody = document.querySelector(`#${tableId} tbody`);
    tableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();

    sorted.forEach((key, index) => {
        const count = countMap[key];
        const percentage = ((count / total) * 100).toFixed(1);
        const color = colors[index % colors.length];

        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${key}</td>
            <td>${count}</td>
            <td>${percentage}%</td>
            <td><div class="progress-bar"><div class="progress-fill" style="width:${percentage}%;background-color:${color}"></div></div></td>
        `;
        fragment.appendChild(row);
    });
    tableBody.appendChild(fragment);
}

function updateModelsTable(counts, total) {
    buildTableWithBars('models-table', counts, total, [
        'var(--chart-color-1)', 'var(--chart-color-2)', 'var(--chart-color-3)',
        'var(--chart-color-4)', 'var(--chart-color-5)'
    ]);
}

function updatePurposesTable(counts, total) {
    buildTableWithBars('purposes-table', counts, total, [
        'var(--chart-color-6)', 'var(--chart-color-7)', 'var(--chart-color-8)',
        'var(--chart-color-9)', 'var(--chart-color-10)'
    ]);
}

function updateProjectsTable(counts, total) {
    buildTableWithBars('projects-table', counts, total, [
        'var(--chart-color-1)', 'var(--chart-color-4)', 'var(--chart-color-3)',
        'var(--chart-color-5)', 'var(--chart-color-2)'
    ]);
}

function updateModelsByProjectTable(modelProjectCounts) {
    const tableBody = document.querySelector('#models-by-project-table tbody');
    const rows = Object.entries(modelProjectCounts)
        .map(([key, count]) => {
            const [projectName, modelName] = key.split('\u0000');
            return { projectName, modelName, count };
        })
        .sort((first, second) =>
            second.count - first.count ||
            first.projectName.localeCompare(second.projectName, 'es') ||
            first.modelName.localeCompare(second.modelName, 'es')
        );

    tableBody.innerHTML = '';
    if (rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="no-data-message">No hay datos disponibles</td></tr>';
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(item => {
        const row = document.createElement('tr');
        [item.projectName, item.modelName, String(item.count)].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        fragment.appendChild(row);
    });
    tableBody.appendChild(fragment);
}

function updateTagPairsTable(tagPairCounts) {
    const tableBody = document.querySelector('#tag-pairs-table tbody');
    const rows = Object.entries(tagPairCounts)
        .map(([key, count]) => ({ tags: key.split('\u0000'), count }))
        .sort((first, second) =>
            second.count - first.count ||
            first.tags.join(' + ').localeCompare(second.tags.join(' + '), 'es')
        );

    tableBody.innerHTML = '';
    if (rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="2" class="no-data-message">No hay etiquetas que aparezcan juntas</td></tr>';
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(item => {
        const row = document.createElement('tr');
        const tagsCell = document.createElement('td');
        tagsCell.textContent = item.tags.join(' + ');
        const countCell = document.createElement('td');
        countCell.textContent = String(item.count);
        row.appendChild(tagsCell);
        row.appendChild(countCell);
        fragment.appendChild(row);
    });
    tableBody.appendChild(fragment);
}

function updateTimeline(recordsByDate) {
    const sortedDates = Object.keys(recordsByDate).sort().reverse();
    const maxCount = Math.max(...Object.values(recordsByDate));
    const timelineContainer = document.getElementById('timeline-container');
    timelineContainer.innerHTML = '';

    if (sortedDates.length === 0) {
        timelineContainer.innerHTML = '<div class="no-data-message">No hay datos disponibles</div>';
        return;
    }

    const fragment = document.createDocumentFragment();
    sortedDates.forEach(dateKey => {
        const count = recordsByDate[dateKey];
        const percentage = (count / maxCount) * 100;
        const [year, month, day] = dateKey.split('-');
        const formattedDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
            .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.innerHTML = `
            <div class="timeline-date">
                <span>${formattedDate}</span>
                <span class="timeline-count" title="${count} ${count === 1 ? 'interacción' : 'interacciones'}">${count}</span>
            </div>
            <div class="timeline-bar-container" aria-hidden="true">
                <div class="timeline-bar" style="width:${percentage}%"></div>
            </div>
        `;
        fragment.appendChild(item);
    });
    timelineContainer.appendChild(fragment);
}

function updateTagsCloud(tagCounts) {
    const topTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 30);
    const tagsCloud = document.getElementById('tags-cloud');
    tagsCloud.innerHTML = '';

    if (topTags.length === 0) {
        tagsCloud.innerHTML = '<div class="no-data-message">No hay etiquetas disponibles</div>';
        return;
    }

    const minCount = Math.min(...topTags.map(t => tagCounts[t]));
    const maxCount = Math.max(...topTags.map(t => tagCounts[t]));
    const colors = [
        'var(--primary-color)',
        'var(--accent-color)',
        'rgba(40, 38, 102, 0.82)',
        'rgba(255, 186, 40, 0.82)',
        'rgba(40, 38, 102, 0.62)'
    ];

    const fragment = document.createDocumentFragment();
    topTags.forEach((tag, index) => {
        const count = tagCounts[tag];
        const fontSize = maxCount === minCount
            ? 14
            : 14 + ((count - minCount) / (maxCount - minCount)) * 14;

        const tagElement = document.createElement('div');
        tagElement.className = 'tag-cloud-item';
        tagElement.textContent = tag;
        tagElement.style.fontSize = `${fontSize}px`;
        tagElement.style.backgroundColor = colors[index % colors.length];
        tagElement.title = `${tag}: ${count} ${count === 1 ? 'ocurrencia' : 'ocurrencias'}`;
        fragment.appendChild(tagElement);
    });
    tagsCloud.appendChild(fragment);
}

// --- HERRAMIENTAS ---

function populateExportProjectFilter(projects) {
    const filter = document.getElementById('export-project-filter');
    if (!filter) return;

    const currentValue = filter.value || 'all';
    filter.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'Todos los proyectos y registros';
    filter.appendChild(allOption);

    const noneOption = document.createElement('option');
    noneOption.value = 'none';
    noneOption.textContent = 'Registros sin proyecto';
    filter.appendChild(noneOption);

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        filter.appendChild(option);
    });

    filter.value = Array.from(filter.options).some(option => option.value === currentValue)
        ? currentValue
        : 'all';
}

async function getScopedExportData() {
    const [records, projects] = await Promise.all([
        loadFromStorage('chatlog_records'),
        loadFromStorage('chatlog_projects')
    ]);
    const safeRecords = records || [];
    const safeProjects = projects || [];
    const scope = document.getElementById('export-project-filter')?.value || 'all';

    if (scope === 'all') {
        return { records: safeRecords, projects: safeProjects, scope, scopeName: 'completo' };
    }
    if (scope === 'none') {
        return {
            records: safeRecords.filter(record => !record.projectId),
            projects: [],
            scope,
            scopeName: 'sin_proyecto'
        };
    }

    const selectedProject = safeProjects.find(project => project.id === scope);
    return {
        records: safeRecords.filter(record => record.projectId === scope),
        projects: selectedProject ? [selectedProject] : [],
        scope,
        scopeName: selectedProject ? sanitizeFilenamePart(selectedProject.name) : 'proyecto'
    };
}

function sanitizeFilenamePart(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'datos';
}

async function exportAllData() {
    const { records, projects, scope, scopeName } = await getScopedExportData();

    const data = {
        records,
        projects,
        metadata: {
            version: '1.0',
            exportDate: new Date().toISOString(),
            type: scope === 'all' ? 'full' : 'project',
            scope,
            schema: 'chatlog-internal-v1'
        }
    };

    downloadJSON(data, `chatlog_backup_${scopeName}`);
}

async function exportCSV() {
    const { records, projects, scopeName } = await getScopedExportData();

    if (records.length === 0) {
        showAppStatus('No hay registros para exportar.', 'error');
        return;
    }

    const projectsMap = {};
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    const headers = [
        'Nombre del Proyecto', 'ID del proyecto', 'Nombre de la interacción',
        'Fecha de interacción', 'Empresa proveedora', 'Modelo y versión',
        'Liga a la interacción', 'Prompt', 'Etiquetas', 'Etapa del trabajo',
        'Verificación humana y responsabilidad', 'Observaciones', 'Calificación', 'Importante',
        'Tipo de evidencia', 'Referencia de evidencia'
    ];

    let csvContent = headers.join(',') + '\n';

    records.forEach(record => {
        const row = [
            escapeCsvValue(record.projectId ? projectsMap[record.projectId] || 'Proyecto Desconocido' : 'Sin proyecto'),
            escapeCsvValue(record.projectId || ''),
            escapeCsvValue(record.interactionName),
            escapeCsvValue(record.interactionDate || ''),
            escapeCsvValue(record.providerCompany || ''),
            escapeCsvValue(`${record.llmName}${record.llmVersion ? ` (${record.llmVersion})` : ''}`),
            escapeCsvValue(record.interactionLink || ''),
            escapeCsvValue(record.prompt),
            escapeCsvValue(Array.isArray(record.tags) ? record.tags.join('; ') : ''),
            escapeCsvValue(record.ethicalNotes || ''),
            escapeCsvValue(record.biasNotes || ''),
            escapeCsvValue(record.observations || ''),
            escapeCsvValue(record.rating || '0'),
            escapeCsvValue(record.isImportant ? 'Sí' : 'No'),
            escapeCsvValue(getEvidenceType(record)),
            escapeCsvValue(record.evidenceReference || '')
        ];
        csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename = `chatlog_registros_${scopeName}_${new Date().toISOString().split('T')[0]}.csv`;

    chrome.downloads.download({ url, filename, saveAs: false }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error al descargar CSV:', chrome.runtime.lastError);
            showAppStatus('Error al descargar el archivo CSV.', 'error');
        }
        markBackupCompleted();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

function escapeCsvValue(value) {
    if (value === null || value === undefined) return '""';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function downloadJSON(data, filename) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fullFilename = `${filename}_${new Date().toISOString().split('T')[0]}.json`;

    chrome.downloads.download({ url, filename: fullFilename, saveAs: false }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error al descargar JSON:', chrome.runtime.lastError);
            showAppStatus('Error al descargar el archivo.', 'error');
        }
        markBackupCompleted();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

async function importData() {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files[0];
    const importMode = document.getElementById('import-mode').value;

    if (!file) {
        showAppStatus('Selecciona un archivo JSON para importar.', 'error');
        return;
    }

    const actionDescription = importMode === 'replace'
        ? 'Se eliminarán los proyectos y registros actuales y se reemplazarán con los del archivo.'
        : 'Los datos del archivo se fusionarán con los actuales; los identificadores ya existentes se conservarán sin duplicarse.';
    if (!await appConfirm(`${actionDescription}\n\n¿Deseas continuar?`, {
        title: 'Importar datos',
        confirmLabel: 'Importar',
        danger: importMode === 'replace'
    })) return;

    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            let importedRecordsForReport = [];
            let importedProjectCount = 0;
            let skippedRecordCount = 0;
            let skippedProjectCount = 0;

            if (!importedData.metadata || !importedData.metadata.version) {
                throw new Error('El archivo no parece ser un respaldo válido de ChatLog.');
            }
            if (!Array.isArray(importedData.records)) {
                throw new Error('El respaldo no contiene una lista válida de registros.');
            }
            if (
                ['full', 'project'].includes(importedData.metadata.type) &&
                !Array.isArray(importedData.projects)
            ) {
                throw new Error('El respaldo no contiene una lista válida de proyectos.');
            }

            const existingRecords = await loadFromStorage('chatlog_records') || [];
            const existingProjects = await loadFromStorage('chatlog_projects') || [];
            const shouldImportProjects = Boolean(
                importedData.projects &&
                Array.isArray(importedData.projects) &&
                ['full', 'project'].includes(importedData.metadata.type)
            );
            const projectImport = shouldImportProjects
                ? reconcileImportedProjects(importedData.projects, existingProjects, importMode)
                : {
                    projects: existingProjects,
                    projectIdMap: new Map(),
                    importedCount: 0,
                    skippedCount: 0
                };
            importedProjectCount = projectImport.importedCount;
            skippedProjectCount = projectImport.skippedCount;

            const validProjectIds = new Set(projectImport.projects.map(project => String(project.id)));
            const normalizedRecords = normalizeImportedJsonRecords(importedData.records).map(record => {
                if (!record.projectId) return record;

                const sourceProjectId = String(record.projectId);
                const mappedProjectId = projectImport.projectIdMap.get(sourceProjectId) || sourceProjectId;
                return {
                    ...record,
                    projectId: validProjectIds.has(String(mappedProjectId)) ? mappedProjectId : null
                };
            });

            if (importMode === 'merge') {
                const seenRecordIds = new Set(existingRecords.map(record => record.id));
                const newRecords = normalizedRecords.filter(record => {
                    if (seenRecordIds.has(record.id)) return false;
                    seenRecordIds.add(record.id);
                    return true;
                });
                importedRecordsForReport = newRecords;
                skippedRecordCount = normalizedRecords.length - newRecords.length;

                if (shouldImportProjects) {
                    await saveToStorage('chatlog_projects', projectImport.projects, {
                        countBackupChange: false
                    });
                }
                await saveToStorage('chatlog_records', [...existingRecords, ...newRecords]);
            } else {
                const seenRecordIds = new Set();
                const replacementRecords = normalizedRecords.filter(record => {
                    if (seenRecordIds.has(record.id)) return false;
                    seenRecordIds.add(record.id);
                    return true;
                });
                importedRecordsForReport = replacementRecords;
                skippedRecordCount = normalizedRecords.length - replacementRecords.length;

                if (shouldImportProjects) {
                    await saveToStorage('chatlog_projects', projectImport.projects, {
                        countBackupChange: false
                    });
                }
                await saveToStorage('chatlog_records', replacementRecords);
                resetRecordForm();
            }

            await loadProjects();
            await loadQuickAccessList();
            await loadProjectsForManagement();
            await initRecordsManagement();

            fileInput.value = '';
            document.getElementById('json-preview-container').style.display = 'none';
            const finalRecords = await loadFromStorage('chatlog_records') || [];
            await appAlert(buildImportReport(
                'JSON',
                importedRecordsForReport,
                finalRecords,
                importedProjectCount,
                skippedRecordCount,
                skippedProjectCount
            ), { title: 'Importación completada' });
        } catch (error) {
            console.error('Error al importar datos:', error);
            await appAlert(`Error al importar datos: ${error.message}`, {
                title: 'No se pudieron importar los datos'
            });
        }
    };

    reader.onerror = () => showAppStatus('Error al leer el archivo.', 'error');
    reader.readAsText(file);
}

function previewJSON() {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files[0];
    const previewContainer = document.getElementById('json-preview-container');
    const previewElement = document.getElementById('json-preview');

    if (!file) {
        previewContainer.style.display = 'none';
        previewElement.textContent = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const data = JSON.parse(event.target.result);
            if (!data.metadata?.version) {
                throw new Error('El archivo no contiene metadatos reconocibles de ChatLog.');
            }

            const records = Array.isArray(data.records) ? data.records : [];
            const projects = Array.isArray(data.projects) ? data.projects : [];
            const scopeText = data.metadata.type === 'full'
                ? 'Respaldo completo'
                : 'Respaldo de proyecto o selección';
            const projectNames = projects.slice(0, 5).map(project => project.name).filter(Boolean);
            const lines = [
                `${scopeText}.`,
                `Versión del respaldo: ${data.metadata.version}.`,
                `Proyectos incluidos: ${projects.length}.`,
                `Registros incluidos: ${records.length}.`
            ];
            if (projectNames.length > 0) {
                lines.push(`Proyectos: ${projectNames.join(', ')}${projects.length > 5 ? ', ...' : ''}.`);
            }

            previewElement.textContent = lines.join('\n');
            previewContainer.style.display = 'block';
        } catch (error) {
            previewElement.textContent = `No se puede importar este archivo: ${error.message}`;
            previewContainer.style.display = 'block';
        }
    };
    reader.onerror = () => {
        previewElement.textContent = 'Error al leer el archivo.';
        previewContainer.style.display = 'block';
    };
    reader.readAsText(file);
}

function previewCSV() {
    const fileInput = document.getElementById('csv-file');
    const file = fileInput.files[0];
    const previewContainer = document.getElementById('csv-preview-container');
    const previewElement = document.getElementById('csv-preview');

    if (!file) {
        previewContainer.style.display = 'none';
        return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const records = parseCSV(e.target.result);

            if (records.length === 0) {
                previewElement.innerHTML = '<p class="no-data-message">El archivo CSV está vacío o tiene un formato incorrecto.</p>';
                previewContainer.style.display = 'block';
                return;
            }

            const headers = Object.keys(records[0]);
            let tableHtml = '<table><thead><tr>';
            headers.forEach(h => { tableHtml += `<th>${h}</th>`; });
            tableHtml += '</tr></thead><tbody>';

            records.slice(0, 5).forEach(row => {
                tableHtml += '<tr>';
                headers.forEach(h => { tableHtml += `<td>${row[h] || ''}</td>`; });
                tableHtml += '</tr>';
            });

            tableHtml += '</tbody></table>';
            if (records.length > 5) tableHtml += `<p class="text-muted">(Mostrando 5 de ${records.length} filas)</p>`;

            previewElement.innerHTML = tableHtml;
            previewContainer.style.display = 'block';
        } catch (error) {
            previewElement.innerHTML = `<p class="no-data-message">Error al procesar el archivo CSV: ${error.message}</p>`;
            previewContainer.style.display = 'block';
        }
    };

    reader.onerror = () => {
        previewElement.innerHTML = '<p class="no-data-message">Error al leer el archivo.</p>';
        previewContainer.style.display = 'block';
    };

    reader.readAsText(file);
}

function normalizeImportedEvidence(record) {
    const reference = String(record.evidenceReference || record['Referencia de evidencia'] || '').trim();
    const type = String(record.evidenceType || record['Tipo de evidencia'] || '').trim().toLowerCase();
    return {
        evidenceType: type === 'local' || (!type && reference) ? 'local' : 'url',
        evidenceReference: reference
    };
}

function normalizeImportedJsonRecords(records) {
    return records.map(record => {
        if (record && Object.prototype.hasOwnProperty.call(record, 'interactionName')) {
            return {
                id: record.id || generateUniqueId('record'),
                interactionName: record.interactionName || 'Sin nombre',
                purpose: record.purpose || 'Sin especificar',
                interactionDate: record.interactionDate || '',
                providerCompany: record.providerCompany || '',
                llmName: record.llmName || 'Sin especificar',
                llmVersion: record.llmVersion || '',
                prompt: record.prompt || '',
                interactionLink: record.interactionLink || '',
                ...normalizeImportedEvidence(record),
                tags: Array.isArray(record.tags) ? record.tags : [],
                ethicalNotes: record.ethicalNotes || '',
                biasNotes: record.biasNotes || '',
                observations: record.observations || '',
                rating: record.rating || '0',
                isImportant: Boolean(record.isImportant),
                projectId: record.projectId || null,
                dateCreated: record.dateCreated || new Date().toISOString(),
                dateModified: record.dateModified || new Date().toISOString()
            };
        }

        return {
            id: record.id || generateUniqueId('record'),
            interactionName: record['Nombre de la interacción'] || 'Sin nombre',
            purpose: record['Finalidad'] || record['Propósito'] || record['Proposito'] || 'Sin especificar',
            interactionDate: record['Fecha de interacción'] || '',
            providerCompany: record['Empresa proveedora'] || '',
            llmName: record['Modelo y versión'] || record['Modelo'] || 'Sin especificar',
            llmVersion: '',
            prompt: record['Prompt'] || '',
            interactionLink: record['Liga a la interacción'] || '',
            ...normalizeImportedEvidence(record),
            tags: Array.isArray(record['Etiquetas'])
                ? record['Etiquetas']
                : String(record['Etiquetas'] || '').split(/[,;]/).map(tag => tag.trim()).filter(Boolean),
            ethicalNotes: record['Etapa del trabajo'] || record['Aspectos éticos'] || '',
            biasNotes: record['Verificación humana y responsabilidad'] || record['Notas sobre mitigación'] || '',
            observations: record['Observaciones'] || '',
            rating: record['Calificación'] || '0',
            isImportant: parseImportedBoolean(record['Importante']),
            projectId: record.projectId || record['ID del proyecto'] || null,
            dateCreated: record.dateCreated || new Date().toISOString(),
            dateModified: record.dateModified || new Date().toISOString()
        };
    });
}

function parseImportedBoolean(value) {
    return ['sí', 'si', 'true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function normalizeProjectName(name) {
    return String(name || '').trim().toLocaleLowerCase('es-MX');
}

function reconcileImportedProjects(importedProjects, existingProjects, importMode) {
    const projects = importMode === 'merge' ? [...existingProjects] : [];
    const projectsById = new Map(projects.map(project => [String(project.id), project]));
    const projectsByName = new Map(
        projects.map(project => [normalizeProjectName(project.name), project])
    );
    const projectIdMap = new Map();
    let importedCount = 0;
    let skippedCount = 0;

    importedProjects.forEach(project => {
        if (!project || typeof project !== 'object') {
            skippedCount += 1;
            return;
        }

        const sourceProjectId = String(project.id || '').trim();
        const projectName = String(project.name || '').trim();
        if (!projectName) {
            skippedCount += 1;
            return;
        }

        const existingProject = (
            (sourceProjectId && projectsById.get(sourceProjectId)) ||
            projectsByName.get(normalizeProjectName(projectName))
        );

        if (existingProject) {
            if (sourceProjectId) projectIdMap.set(sourceProjectId, existingProject.id);
            skippedCount += 1;
            return;
        }

        const projectId = sourceProjectId || generateUniqueId('project');
        const normalizedProject = {
            ...project,
            id: projectId,
            name: projectName,
            dateCreated: project.dateCreated || new Date().toISOString()
        };

        projects.push(normalizedProject);
        projectsById.set(projectId, normalizedProject);
        projectsByName.set(normalizeProjectName(projectName), normalizedProject);
        if (sourceProjectId) projectIdMap.set(sourceProjectId, projectId);
        importedCount += 1;
    });

    return { projects, projectIdMap, importedCount, skippedCount };
}

function parseCSV(csvContent) {
    if (csvContent.charCodeAt(0) === 0xFEFF) csvContent = csvContent.slice(1);

    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;
    let quotedValue = false;

    const pushValue = () => {
        row.push(quotedValue ? value : value.trim());
        value = '';
        quotedValue = false;
    };
    const pushRow = () => {
        pushValue();
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
    };

    for (let index = 0; index < csvContent.length; index += 1) {
        const char = csvContent[index];

        if (inQuotes) {
            if (char === '"' && csvContent[index + 1] === '"') {
                value += '"';
                index += 1;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                value += char;
            }
            continue;
        }

        if (char === '"' && value === '') {
            inQuotes = true;
            quotedValue = true;
        } else if (char === ',') {
            pushValue();
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && csvContent[index + 1] === '\n') index += 1;
            pushRow();
        } else {
            value += char;
        }
    }

    if (inQuotes) {
        throw new Error('El archivo CSV contiene un campo entre comillas sin cerrar.');
    }
    if (value !== '' || row.length > 0) pushRow();
    if (rows.length <= 1) return [];

    const headers = rows[0].map(header => header.trim());
    return rows.slice(1).map(values => {
        const record = {};
        headers.forEach((header, index) => {
            record[header] = index < values.length ? values[index] : '';
        });
        return record;
    });
}

async function importCSV() {
    const fileInput = document.getElementById('csv-file');
    const file = fileInput.files[0];
    const importMode = document.getElementById('import-mode').value;

    if (!file) {
        showAppStatus('Selecciona un archivo CSV para importar.', 'error');
        return;
    }

    const actionDescription = importMode === 'replace'
        ? 'Se reemplazarán los proyectos y registros actuales con los datos del archivo CSV.'
        : 'Los registros del archivo CSV se agregarán a los datos actuales.';
    if (!await appConfirm(`${actionDescription}\n\n¿Deseas continuar?`, {
        title: 'Importar registros',
        confirmLabel: 'Importar',
        danger: importMode === 'replace'
    })) return;

    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            const csvRecords = parseCSV(e.target.result);

            if (csvRecords.length === 0) {
                showAppStatus('El archivo CSV está vacío o tiene un formato incorrecto.', 'error');
                return;
            }

            const firstRecord = csvRecords[0];
            const fieldMapping = {};

            Object.keys(firstRecord).forEach(key => {
                const k = key.toLowerCase();
                if (k.includes('nombre del proyecto') || k === 'proyecto') fieldMapping.projectName = key;
                else if (k.includes('id del proyecto') || k === 'id proyecto') fieldMapping.projectId = key;
                else if (k.includes('fecha de interacción') || k.includes('fecha de interaccion')) fieldMapping.interactionDate = key;
                else if (k.includes('empresa proveedora') || k.includes('proveedor')) fieldMapping.providerCompany = key;
                else if (k === 'tipo de evidencia') fieldMapping.evidenceType = key;
                else if (k === 'referencia de evidencia') fieldMapping.evidenceReference = key;
                else if (k.includes('liga a la interacción') || k.includes('liga a la interaccion') || k.includes('enlace') || k.includes('link') || k.includes('url')) fieldMapping.link = key;
                else if (k.includes('nombre de la interacción') || k.includes('nombre') || k.includes('interacción')) fieldMapping.name = key;
                else if (k.includes('finalidad') || k.includes('propósito') || k.includes('proposito') || k.includes('purpose')) fieldMapping.purpose = key;
                else if (k.includes('modelo y versión') || k.includes('modelo') || k.includes('llm')) fieldMapping.model = key;
                else if (k.includes('prompt') || k.includes('consulta')) fieldMapping.prompt = key;
                else if (k.includes('etiquetas') || k.includes('tags')) fieldMapping.tags = key;
                else if (k.includes('etapa del trabajo') || k.includes('aspectos éticos') || k.includes('ética') || k.includes('ethic')) fieldMapping.ethics = key;
                else if (k.includes('verificación humana') || k.includes('verificacion humana') || k.includes('responsabilidad') || k.includes('notas sobre mitigación') || k.includes('mitigación') || k.includes('sesgo') || k.includes('bias')) fieldMapping.bias = key;
                else if (k.includes('observaciones') || k.includes('observa') || k.includes('nota') || k.includes('note')) fieldMapping.notes = key;
                else if (k.includes('calificación') || k.includes('rating') || k.includes('stars') || k.includes('estrella')) fieldMapping.rating = key;
                else if (k.includes('importante') || k.includes('destacado') || k.includes('fijado')) fieldMapping.important = key;
            });

            const existingProjects = await loadFromStorage('chatlog_projects') || [];
            const baseProjects = importMode === 'replace' ? [] : existingProjects;
            const projectsById = new Map(baseProjects.map(project => [project.id, project]));
            const projectsByName = new Map(baseProjects.map(project => [project.name.trim().toLowerCase(), project]));
            const importedProjects = [...baseProjects];

            const resolveProjectId = (csvRecord) => {
                const rawProjectId = fieldMapping.projectId ? (csvRecord[fieldMapping.projectId] || '').trim() : '';
                if (rawProjectId && projectsById.has(rawProjectId)) {
                    return rawProjectId;
                }

                const rawProjectName = fieldMapping.projectName ? (csvRecord[fieldMapping.projectName] || '').trim() : '';
                if (!rawProjectName || rawProjectName.toLowerCase() === 'sin proyecto') {
                    return null;
                }

                const normalizedName = rawProjectName.toLowerCase();
                if (projectsByName.has(normalizedName)) {
                    return projectsByName.get(normalizedName).id;
                }

                const newProject = {
                    id: generateUniqueId('project'),
                    name: rawProjectName,
                    dateCreated: new Date().toISOString()
                };

                importedProjects.push(newProject);
                projectsById.set(newProject.id, newProject);
                projectsByName.set(normalizedName, newProject);
                return newProject.id;
            };

            const newRecords = csvRecords.map(csvRecord => {
                const modelFull = csvRecord[fieldMapping.model] || 'Sin especificar';
                let model = modelFull;
                let version = '';

                const match = modelFull.match(/(.+)\s*\((.+)\)/);
                if (match) { model = match[1].trim(); version = match[2].trim(); }

                return {
                    id: generateUniqueId('record'),
                    interactionName: csvRecord[fieldMapping.name] || 'Importado desde CSV',
                    purpose: csvRecord[fieldMapping.purpose] || 'Sin especificar',
                    interactionDate: fieldMapping.interactionDate ? csvRecord[fieldMapping.interactionDate] : '',
                    providerCompany: fieldMapping.providerCompany ? csvRecord[fieldMapping.providerCompany] : '',
                    llmName: model,
                    llmVersion: version,
                    prompt: fieldMapping.prompt ? csvRecord[fieldMapping.prompt] : '',
                    interactionLink: fieldMapping.link ? csvRecord[fieldMapping.link] : '',
                    ...normalizeImportedEvidence({
                        evidenceType: fieldMapping.evidenceType ? csvRecord[fieldMapping.evidenceType] : '',
                        evidenceReference: fieldMapping.evidenceReference ? csvRecord[fieldMapping.evidenceReference] : ''
                    }),
                    tags: fieldMapping.tags ? csvRecord[fieldMapping.tags].split(/[,;]/).map(t => t.trim()).filter(Boolean) : [],
                    ethicalNotes: fieldMapping.ethics ? csvRecord[fieldMapping.ethics] : '',
                    biasNotes: fieldMapping.bias ? csvRecord[fieldMapping.bias] : '',
                    observations: fieldMapping.notes ? csvRecord[fieldMapping.notes] : '',
                    rating: fieldMapping.rating ? csvRecord[fieldMapping.rating] : '0',
                    isImportant: fieldMapping.important
                        ? parseImportedBoolean(csvRecord[fieldMapping.important])
                        : false,
                    projectId: resolveProjectId(csvRecord),
                    dateCreated: new Date().toISOString(),
                    dateModified: new Date().toISOString()
                };
            });

            const records = await loadFromStorage('chatlog_records') || [];
            const importedProjectCount = importedProjects.length - baseProjects.length;
            await saveToStorage('chatlog_projects', importedProjects, {
                countBackupChange: false
            });
            const finalRecords = importMode === 'replace' ? newRecords : [...records, ...newRecords];
            await saveToStorage('chatlog_records', finalRecords);
            if (importMode === 'replace') resetRecordForm();

            await loadProjects();
            await loadQuickAccessList();
            await updateAllTags();

            if (document.getElementById('tools').classList.contains('active')) {
                await initRecordsManagement();
            }

            fileInput.value = '';
            document.getElementById('csv-preview-container').style.display = 'none';
            await appAlert(
                buildImportReport('CSV', newRecords, finalRecords, importedProjectCount),
                { title: 'Importación completada' }
            );
        } catch (error) {
            console.error('Error al importar CSV:', error);
            await appAlert(`Error al importar el archivo CSV: ${error.message}`, {
                title: 'No se pudo importar el archivo'
            });
        }
    };

    reader.onerror = () => showAppStatus('Error al leer el archivo.', 'error');
    reader.readAsText(file);
}
