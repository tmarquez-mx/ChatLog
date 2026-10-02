const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8');
const fields = ['record-id', 'interaction-name', 'purpose', 'other-purpose', 'interaction-date',
    'provider-company', 'llm-name', 'llm-version', 'prompt', 'interaction-link', 'ethical-notes',
    'bias-notes', 'observations', 'rating-value', 'evidence-type', 'evidence-reference'];

function app(initial = {}) {
    const data = { ...initial };
    const elements = new Map();
    const timers = new Map();
    const downloads = [];
    const reads = [];
    let timerId = 0;
    let failKey;
    let failReadKey;
    const el = id => {
        if (!elements.has(id)) elements.set(id, {
            value: '', textContent: '', hidden: true, style: {}, dataset: {},
            options: [{value: 'all'}, {value: 'none'}, {value: 'p1'}, {value: 'Análisis'}, {value: 'Otro'}],
            classList: { contains: () => false }, setAttribute() {}, removeAttribute() {},
            setCustomValidity() {}, scrollIntoView() {}, focus() {},
            reset() { fields.forEach(field => el(field).value = ''); }
        });
        return elements.get(id);
    };
    el('project-select').value = 'none';
    el('rating-value').value = '0';
    el('evidence-type').value = 'url';
    const chrome = { runtime: {}, downloads: {download(options) {downloads.push(options);}}, storage: { local: {
        get(keys, callback) { queueMicrotask(() => {
            if (keys.includes(failReadKey)) chrome.runtime.lastError = {message: 'Read failed'};
            callback(Object.fromEntries(keys.map(key => [key, data[key]])));
            delete chrome.runtime.lastError;
        }); },
        set(values, callback) {
            queueMicrotask(() => {
                if (Object.keys(values).includes(failKey)) chrome.runtime.lastError = { message: 'Quota exceeded' };
                else Object.assign(data, values);
                callback();
                delete chrome.runtime.lastError;
            });
        }
    }}};
    const context = vm.createContext({
        console: { log() {}, error() {} }, URL, Date, Map, Set, Promise, Blob, Uint8Array,
        FileReader: class {readAsText(file) {reads.push(this.onload({target: {result: file.text}}));}},
        document: { addEventListener() {}, getElementById: el },
        window: {}, chrome,
        setTimeout(fn, delay) { timers.set(++timerId, {fn, delay}); return timerId; },
        clearTimeout(id) { timers.delete(id); }
    });
    vm.runInContext(source, context);
    vm.runInContext(`
        showAppStatus = () => {};
        updateStorageUsage = () => {};
        refreshGuidedFlowState = async () => {};
        trackBackupChange = () => {};
        loadQuickAccessList = async () => {};
        updateAllTags = async () => {};
        updateTagsList = () => {};
        evaluateBackupReminder = async () => {};
        window.loadRating = value => document.getElementById('rating-value').value = String(value);
    `, context);
    return { data, el, timers, downloads, reads, run: code => vm.runInContext(code, context), fail: key => { failKey = key; },
        failRead: key => { failReadKey = key; },
        records: () => JSON.parse(data.chatlog_records || '[]') };
}

function complete(a) {
    for (const [id, value] of Object.entries({ 'interaction-name': 'Lectura', purpose: 'Análisis',
        'llm-name': 'Modelo', prompt: 'Compara las ideas', 'interaction-link': 'https://example.com/chat',
        'interaction-date': '2026-09-30' })) a.el(id).value = value;
}

test('el aviso identifica la versión instalada en declaraciones estándar y detalladas', async () => {
    const a = app({chatlog_records: JSON.stringify([{id: 'r1', interactionName: 'Prueba', purpose: 'Análisis', llmName: 'Modelo'}])});
    a.run(`
        chrome.runtime.getManifest = () => ({version: '2.0.1'});
        selectedRecords = ['r1'];
        loadQualityReviewSettings = async () => {};
        validateDeclarationRecords = () => [];
        renderDeclarationPreview = text => window.generatedDeclaration = text;
    `);
    for (const format of ['standard', 'detailed']) {
        a.el('declaration-format').value = format;
        await a.run('generateDeclaration()');
        assert.match(a.run('window.generatedDeclaration'), /Esta declaración fue generada automáticamente utilizando ChatLog, versión 2\.0\.1\./);
    }
    a.run("chrome.runtime.getManifest = () => ({version: '2.0.2'})");
    await a.run('generateDeclaration()');
    assert.match(a.run('window.generatedDeclaration'), /ChatLog, versión 2\.0\.2\./);
    a.run('delete chrome.runtime.getManifest');
    assert.equal(a.run('getChatLogVersion()'), '2.0.1');
});

test('guarda un registro nuevo incompleto sin pulsar Guardar', async () => {
    const a = app();
    a.el('prompt').value = 'Primer borrador';
    a.run('markRecordFormDirty()');
    // La pausa de escritura dispara el guardado real.
    [...a.timers.values()].find(timer => timer.delay === 800).fn();
    await a.run('recordAutosaveQueue');
    assert.equal(a.records().length, 1);
    assert.equal(a.records()[0].prompt, 'Primer borrador');
    assert.equal(a.records()[0].isDraft, true);
    assert.match(a.el('record-unsaved-indicator').textContent, /Borrador guardado/);
});

test('editar y completar el borrador conserva un único identificador', async () => {
    const a = app();
    a.el('prompt').value = 'Inicio';
    a.run('markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    const id = a.records()[0].id;
    complete(a);
    a.run('markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    assert.equal(a.records().length, 1);
    assert.equal(a.records()[0].id, id);
    assert.equal(a.records()[0].isDraft, false);
    assert.equal(a.records()[0].interactionDate, '2026-09-30');
    assert.equal(a.el('record-unsaved-indicator').textContent, 'Guardado');
});

test('Nuevo registro guarda de inmediato, conserva el anterior y vacía el formulario', async () => {
    const a = app();
    a.el('interaction-name').value = 'Primero';
    a.run('markRecordFormDirty()');
    await a.run('startNewRecord()');
    assert.equal(a.records().length, 1);
    assert.equal(a.el('record-id').value, '');
    assert.equal(a.el('interaction-name').value, '');
    await a.run('recoverySaveQueue');
    assert.equal(JSON.parse(a.data.chatlog_active_record_draft), null);
    a.el('interaction-name').value = 'Segundo';
    a.run('markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    assert.equal(a.records().length, 2);
    assert.notEqual(a.records()[0].id, a.records()[1].id);
});

test('recupera texto incompleto tras cerrar antes de la pausa de guardado', async () => {
    const a = app();
    a.el('prompt').value = 'Texto todavía incompleto';
    a.el('purpose').value = 'Otro';
    a.el('other-purpose').value = 'Idea propia';
    a.run("currentTags = ['tesis']; markRecordFormDirty()");
    await a.run('recoverySaveQueue');
    assert.equal(a.records().length, 0);
    const b = app(a.data);
    await b.run('restoreActiveRecordDraft()');
    assert.equal(b.el('prompt').value, 'Texto todavía incompleto');
    assert.equal(b.el('other-purpose').value, 'Idea propia');
    assert.equal(b.records().length, 1);
    assert.deepEqual(b.records()[0].tags, ['tesis']);
});

test('recuperar un registro ya guardado no crea otra copia', async () => {
    const a = app();
    complete(a);
    a.run('markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    const b = app(a.data);
    await b.run('restoreActiveRecordDraft()');
    assert.equal(b.records().length, 1);
    assert.equal(b.records()[0].id, a.records()[0].id);
});

test('fallo de almacenamiento mantiene el formulario y permite reintentar', async () => {
    const a = app();
    a.fail('chatlog_records');
    a.el('prompt').value = 'No perder';
    a.run('markRecordFormDirty()');
    assert.equal(await a.run('flushRecordAutosave()'), false);
    assert.match(a.el('record-unsaved-indicator').textContent, /Error/);
    assert.equal(a.el('retry-save-btn').hidden, false);
    await a.run('startNewRecord()');
    assert.equal(a.el('prompt').value, 'No perder');
    a.fail(undefined);
    assert.equal(await a.run('flushRecordAutosave()'), true);
    assert.equal(a.records().length, 1);
});

test('conserva registros y proyectos anteriores y metadatos adicionales', async () => {
    const old = { id: 'old', interactionName: 'Anterior', prompt: 'Original', dateCreated: '2026-06-01',
        projectId: 'p1', isImportant: true, extraMetadata: 'conservar' };
    const a = app({ chatlog_records: JSON.stringify([old]), chatlog_projects: JSON.stringify([{id:'p1', name:'Tesis'}]) });
    await a.run("loadRecordForEdit('old')");
    a.el('prompt').value = 'Revisión';
    a.run('markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    assert.equal(a.records().length, 1);
    assert.equal(a.records()[0].dateCreated, old.dateCreated);
    assert.equal(a.records()[0].extraMetadata, 'conservar');
    assert.equal(a.records()[0].isImportant, true);
    assert.equal(JSON.parse(a.data.chatlog_projects)[0].name, 'Tesis');
});

test('abrir otro registro guarda los cambios pendientes del anterior', async () => {
    const a = app({ chatlog_records: JSON.stringify([{id:'old', interactionName:'Anterior'}]) });
    a.el('interaction-name').value = 'Nuevo pendiente';
    a.run('markRecordFormDirty()');
    await a.run("loadRecordForEdit('old')");
    assert.equal(a.records().length, 2);
    assert.equal(a.records().find(record => record.id !== 'old').interactionName, 'Nuevo pendiente');
    assert.equal(a.el('record-id').value, 'old');
});

test('un temporizador obsoleto no escribe cambios sobre el siguiente registro', async () => {
    const a = app();
    a.el('prompt').value = 'Primero';
    a.run('markRecordFormDirty()');
    const delayed = [...a.timers.values()].find(timer => timer.delay === 800).fn;
    await a.run('startNewRecord()');
    delayed();
    await a.run('recordAutosaveQueue');
    assert.equal(a.records().length, 1);
    assert.equal(a.el('record-id').value, '');
});

test('recuperación no resucita un registro eliminado', async () => {
    const a = app({chatlog_active_record_draft: JSON.stringify({fields:{'record-id':'deleted'},isNew:false})});
    await a.run('restoreActiveRecordDraft()');
    assert.equal(a.records().length, 0);
    assert.equal(JSON.parse(a.data.chatlog_active_record_draft), null);
});

test('guardado tolera una liga inválida como borrador y señala los pendientes', async () => {
    const a = app(); complete(a);
    a.el('interaction-link').value = 'no es una URL';
    a.run('markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    assert.equal(a.records()[0].isDraft, true);
    const quality = a.run('evaluateRecordQuality(JSON.parse(chromeTestRecord))'.replace('chromeTestRecord', JSON.stringify(JSON.stringify(a.records()[0]))));
    assert.equal(quality.status, 'incomplete');
    assert.ok(quality.issues.includes('liga de interacción no válida'));
});

test('manifest y paquete declaran 2.0.1 y mantienen los permisos existentes', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json')));
    const pkg = require('../package.json');
    assert.equal(manifest.version, '2.0.1'); assert.equal(pkg.version, manifest.version);
    assert.deepEqual(manifest.permissions, ['storage', 'sidePanel', 'downloads']);
    assert.equal(manifest.host_permissions, undefined);
});

test('un error de lectura no reemplaza los registros previos por una lista vacía', async () => {
    const previous = JSON.stringify([{id:'old', interactionName:'Conservar'}]);
    const a = app({chatlog_records: previous});
    a.failRead('chatlog_records');
    a.el('prompt').value = 'Nuevo';
    a.run('markRecordFormDirty()');
    assert.equal(await a.run('flushRecordAutosave()'), false);
    assert.equal(a.data.chatlog_records, previous);
    assert.equal(a.el('prompt').value, 'Nuevo');
    a.failRead(undefined);
    assert.equal(await a.run('flushRecordAutosave()'), true);
    assert.equal(a.records().length, 2);
});

test('datos almacenados corruptos se conservan y el guardado señala un error', async () => {
    const a = app({chatlog_records: '{JSON dañado'});
    a.el('prompt').value = 'No perder el nuevo borrador';
    a.run('markRecordFormDirty()');
    assert.equal(await a.run('flushRecordAutosave()'), false);
    assert.equal(a.data.chatlog_records, '{JSON dañado');
    assert.match(a.el('record-unsaved-indicator').textContent, /Error/);
});

test('evidencia local completa, recuperación y cambio a URL validan solo la opción activa', async () => {
    const a = app(); complete(a);
    a.el('evidence-type').value = 'local';
    a.el('evidence-reference').value = 'Evidencias/revisión.pdf';
    a.el('interaction-link').value = '';
    a.run('updateEvidenceFields(); markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    assert.equal(a.records()[0].isDraft, false);
    assert.equal(a.el('interaction-link').disabled, true);
    const recovered = app(a.data);
    await recovered.run('restoreActiveRecordDraft()');
    assert.equal(recovered.el('evidence-reference').value, 'Evidencias/revisión.pdf');
    assert.equal(recovered.el('evidence-type').value, 'local');
    assert.equal(recovered.el('evidence-reference').required, true);
    recovered.el('evidence-type').value = 'url';
    recovered.run('updateEvidenceFields(); markRecordFormDirty()');
    await recovered.run('flushRecordAutosave()');
    assert.equal(recovered.records()[0].isDraft, true);
    recovered.el('interaction-link').value = 'https://example.com/chat';
    recovered.run('markRecordFormDirty()');
    await recovered.run('flushRecordAutosave()');
    assert.equal(recovered.records()[0].isDraft, false);
    assert.equal(recovered.records().length, 1);
    await recovered.run('startNewRecord()');
    assert.equal(recovered.el('evidence-type').value, 'url');
    assert.equal(recovered.el('evidence-reference').value, '');
});

test('las declaraciones distinguen archivos conservados de enlaces web', async () => {
    const record = {id: 'r1', interactionName:'Lectura', purpose:'Análisis', llmName:'Modelo',
        prompt:'Compara', interactionDate:'2026-10-01', providerCompany:'Proveedor',
        ethicalNotes:'Lectura', biasNotes:'Verificado', projectId:'p1', evidenceType:'local',
        evidenceReference:'Evidencias/lectura.pdf', interactionLink:'URL inactiva'};
    const a = app({chatlog_records:JSON.stringify([record])});
    a.run(`selectedRecords=['r1']; loadQualityReviewSettings=async()=>{};
        renderDeclarationPreview=text=>window.output=text;`);
    a.el('include-links').checked = true;
    a.el('researcher-name').value = 'Ejemplo'; a.el('institution-name').value = 'Institución';
    for(const format of ['standard','detailed','apa','aid']) {
        a.el('declaration-format').value = format;
        await a.run('generateDeclaration()');
        assert.match(a.run('window.output'), /Evidencia conservada: Evidencias\/lectura\.pdf/);
        assert.doesNotMatch(a.run('window.output'), /URL inactiva|\[liga/i);
    }
    assert.equal(a.run(`evaluateRecordQuality(${JSON.stringify(record)}).status`), 'ready');
    assert.equal(a.run(`validateDeclarationRecords([${JSON.stringify(record)}], 'aid', {includeLinks:true}).length`),0);
});

test('CSV y JSON conservan evidencia local y siguen importando enlaces antiguos', async () => {
    const records = [{id:'r1',interactionName:'Local',llmName:'Modelo',prompt:'Prueba',
        evidenceType:'local',evidenceReference:'Evidencias/archivo, revisión.pdf',interactionLink:''},
        {id:'r2',interactionName:'Web',llmName:'Modelo',interactionLink:'https://example.com/chat'}];
    const a = app({chatlog_records:JSON.stringify(records)});
    await a.run('exportCSV()');
    const csv = await (await fetch(a.downloads[0].url)).text();
    URL.revokeObjectURL(a.downloads[0].url);
    const b = app(); b.el('csv-file').files = [{text:csv}];
    b.el('import-mode').value = 'merge';
    b.run('appConfirm=async()=>true; appAlert=async()=>{}; loadProjects=async()=>{};');
    await b.run('importCSV()'); await b.reads[0];
    assert.equal(b.records().length,2);
    assert.equal(b.records()[0].interactionName,'Local');
    assert.equal(b.records()[0].evidenceType,'local');
    assert.equal(b.records()[0].evidenceReference,records[0].evidenceReference);
    assert.equal(b.records()[1].interactionLink,records[1].interactionLink);
    assert.equal(b.records()[1].evidenceType,'url');
    const imported = b.run(`normalizeImportedJsonRecords(${JSON.stringify(records)})`);
    assert.equal(imported[0].evidenceReference,records[0].evidenceReference);
    assert.equal(imported[1].evidenceType,'url');
});
