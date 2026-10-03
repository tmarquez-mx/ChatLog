import { QUALITY_RULES_KEY, appState, ui } from './runtime.js';

const collectionKeys = new Set(['chatlog_projects', 'chatlog_records']);
const serializedCache = new Map();
const changeVersions = new Map();
let usageTimer = null;

function shouldCountBackupChange(key, options = {}) {
    return collectionKeys.has(key) && options.countBackupChange !== false;
}

function cacheStorageValues(values) {
    let collectionsChanged = false;
    for (const [key, value] of Object.entries(values)) {
        if (appState.storageCache.has(key) && serializedCache.get(key) === value) continue;
        try {
            appState.storageCache.set(key, value ? JSON.parse(value) : null);
            serializedCache.set(key, value);
        } catch (error) {
            appState.storageCache.delete(key);
            serializedCache.delete(key);
            console.error('Datos almacenados no válidos:', error);
        }
        changeVersions.set(key, (changeVersions.get(key) || 0) + 1);
        if (collectionKeys.has(key)) collectionsChanged = true;
        if (key === QUALITY_RULES_KEY) appState.qualityRulesLoaded = false;
    }
    if (collectionsChanged) {
        appState.storageRevision += 1;
        appState.statisticsDataCache = null;
    }
}

function preloadStorage(keys, {refresh = false} = {}) {
    const requested = refresh ? keys : keys.filter(key => !appState.storageCache.has(key));
    if (!requested.length) return Promise.resolve(true);
    const versions = new Map(requested.map(key => [key, changeVersions.get(key)]));
    return new Promise(resolve => {
        try {
            chrome.storage.local.get(requested, result => {
                if (chrome.runtime.lastError) {
                    console.error('Error al cargar:', chrome.runtime.lastError);
                    resolve(false);
                    return;
                }
                // Un evento posterior a la solicitud tiene prioridad sobre su respuesta.
                cacheStorageValues(Object.fromEntries(requested
                    .filter(key => versions.get(key) === changeVersions.get(key))
                    .map(key => [key, result[key]])));
                resolve(requested.every(key => appState.storageCache.has(key)));
            });
        } catch (error) {
            console.error('Error al cargar del almacenamiento:', error);
            resolve(false);
        }
    });
}

function loadFromStorage(key) {
    if (appState.storageCache.has(key)) return Promise.resolve(appState.storageCache.get(key));
    if (appState.pendingStorageLoads.has(key)) return appState.pendingStorageLoads.get(key);
    const pending = preloadStorage([key])
        .then(() => appState.storageCache.get(key) ?? null)
        .finally(() => appState.pendingStorageLoads.delete(key));
    appState.pendingStorageLoads.set(key, pending);
    return pending;
}

function saveToStorage(key, data, options = {}) {
    return saveStorageValues({[key]: data}, options);
}

function saveStorageValues(values, options = {}) {
    return new Promise(resolve => {
        try {
            // Serializar todo antes de escribir conserva la validación del lote completo.
            const serialized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, JSON.stringify(value)]));
            const changed = Object.entries(serialized).filter(([key, value]) =>
                !appState.storageCache.has(key) || serializedCache.get(key) !== value);
            if (!changed.length) { resolve(true); return; }
            const batch = Object.fromEntries(changed);
            chrome.storage.local.set(batch, () => {
                if (chrome.runtime.lastError) {
                    ui.showAppStatus(`Error al guardar los datos: ${chrome.runtime.lastError.message || 'almacenamiento no disponible'}. Puedes volver a intentarlo.`, 'error');
                    resolve(false);
                    return;
                }
                cacheStorageValues(batch);
                updateStorageUsage();
                if (changed.some(([key]) => shouldCountBackupChange(key, options))) ui.trackBackupChange();
                if (changed.some(([key]) => collectionKeys.has(key))) setTimeout(ui.refreshGuidedFlowState, 0);
                resolve(true);
            });
        } catch (error) {
            console.error('Error al guardar en el almacenamiento:', error);
            ui.showAppStatus('Error al guardar los datos.', 'error');
            resolve(false);
        }
    });
}

async function readCollectionForUpdate(key) {
    const collection = await loadFromStorage(key);
    if (!appState.storageCache.has(key) || (collection !== null && (!Array.isArray(collection) ||
        collection.some(item => !item || typeof item !== 'object' || Array.isArray(item))))) {
        ui.showAppStatus('No se pudieron leer los datos existentes. No se aplicaron cambios; vuelve a intentarlo.', 'error');
        return null;
    }
    return (collection || []).map(item => ({...item}));
}

if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        cacheStorageValues(Object.fromEntries(Object.entries(changes).map(([key, change]) => [key, change.newValue])));
        updateStorageUsage();
    });
}

function updateStorageUsage() {
    if (usageTimer !== null) return;
    usageTimer = setTimeout(() => {
        usageTimer = null;
        chrome.storage.local.getBytesInUse(null, bytes => {
            if (chrome.runtime.lastError) return;
            const element = document.getElementById('storage-usage');
            if (!element) return;
            const quotaMB = (chrome.storage.local.QUOTA_BYTES || 10485760) / (1024 * 1024);
            element.textContent = bytes < 1024 * 1024
                ? `Uso: ${(bytes / 1024).toFixed(1)}KB / ${quotaMB}MB`
                : `Uso: ${(bytes / (1024 * 1024)).toFixed(2)}MB / ${quotaMB}MB`;
        });
    }, 250);
}

export {shouldCountBackupChange, preloadStorage, loadFromStorage, saveToStorage, saveStorageValues,
    readCollectionForUpdate, updateStorageUsage};
