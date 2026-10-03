import { appState, ui } from './runtime.js';

import { loadFromStorage } from './storage.js';

function downloadJSON(data, filename, backup = null) {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const fullFilename = `${filename}_${new Date().toISOString().split('T')[0]}.json`;
    downloadExport(blob, fullFilename, backup);
}

function downloadExport(blob, filename, backup) {
    const url = URL.createObjectURL(blob);
    let downloadId;
    let finished = false;
    const earlyStates = new Map();
    const snapshot = backup?.scope === 'all' ? JSON.stringify([backup.records, backup.projects]) : null;
    const cleanup = () => {
        chrome.downloads.onChanged?.removeListener(onChanged);
        URL.revokeObjectURL(url);
    };
    const finish = async state => {
        if (finished || !['complete', 'interrupted'].includes(state)) return;
        finished = true;
        cleanup();
        if (state === 'interrupted') {
            ui.showAppStatus('La descarga no terminó. No se marcó el respaldo como realizado.', 'error');
            return;
        }
        if (snapshot) {
            await appState.backupChangeQueue;
            const records = await loadFromStorage('chatlog_records');
            const projects = await loadFromStorage('chatlog_projects');
            if (appState.storageCache.has('chatlog_records') && appState.storageCache.has('chatlog_projects') &&
                JSON.stringify([records || [], projects || []]) === snapshot) {
                await ui.markBackupCompleted();
            }
        }
        ui.showAppStatus('Archivo exportado correctamente.');
    };
    const onChanged = delta => {
        const state = delta.state?.current;
        if (!state) return;
        if (downloadId === undefined) earlyStates.set(delta.id, state);
        else if (delta.id === downloadId) void finish(state);
    };
    chrome.downloads.onChanged?.addListener(onChanged);

    chrome.downloads.download({ url, filename, saveAs: false }, id => {
        if (chrome.runtime.lastError) {
            finished = true;
            cleanup();
            console.error('Error al descargar:', chrome.runtime.lastError);
            ui.showAppStatus('Error al descargar el archivo.', 'error');
            return;
        }
        downloadId = id;
        ui.showAppStatus('Descarga iniciada. Espera a que termine y comprueba el archivo.');
        if (id === undefined || !chrome.downloads.onChanged) {
            // La vista local no puede verificar la finalización de una descarga.
            setTimeout(cleanup, 1000);
            return;
        }
        if (earlyStates.has(id)) void finish(earlyStates.get(id));
        chrome.downloads.search?.({ id }, items => {
            if (chrome.runtime.lastError) return;
            if (items?.[0]) void finish(items[0].state);
        });
    });
}

export { downloadJSON, downloadExport };
