const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = require('./helpers/load-source.cjs').loadSource(path.join(__dirname, '..'));
const fields = ['record-id', 'interaction-name', 'purpose', 'other-purpose', 'interaction-date',
    'provider-company', 'llm-name', 'llm-version', 'prompt', 'interaction-link', 'ethical-notes',
    'bias-notes', 'observations', 'rating-value', 'evidence-type', 'evidence-reference'];

function app(initial = {}) {
    const data = { ...initial };
    const elements = new Map();
    const timers = new Map();
    const downloads = [];
    const reads = [];
    const writes = [];
    let timerId = 0;
    let failKey;
    let failReadKey;
    const node = tag => ({
        tagName: tag, textContent: '', children: [], style: {},
        appendChild(child) {
            if (child.tagName === '#fragment') this.children.push(...child.children);
            else this.children.push(child);
            return child;
        },
        replaceChildren(...children) { this.children = children; },
        set innerHTML(value) { this.html = value; this.children = []; },
        get innerHTML() { return this.html || ''; }
    });
    const el = id => {
        if (!elements.has(id)) elements.set(id, {
            ...node('div'),
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
            writes.push(Object.keys(values));
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
        document: { addEventListener() {}, getElementById: el, querySelector: el, querySelectorAll: () => [],
            createElement: node, createDocumentFragment: () => node('#fragment') },
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
    return { data, el, timers, downloads, reads, writes, run: code => vm.runInContext(code, context), fail: key => { failKey = key; },
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

test('las seis empresas y modelos completan su par en ambos sentidos', () => {
    const a = app();
    const pairs = [['Anthropic', 'Claude'], ['OpenAI', 'ChatGPT'], ['Google (DeepMind)', 'Gemini'],
        ['Meta', 'Llama'], ['DeepSeek', 'DeepSeek'], ['Alibaba', 'Qwen']];
    for (const [provider, model] of pairs) {
        a.el('provider-company').value = provider;
        a.el('llm-name').value = 'Anterior';
        a.run('applyProviderModelPair("provider-company")');
        assert.equal(a.el('llm-name').value, model);
        a.el('provider-company').value = 'Anterior';
        a.run('applyProviderModelPair("llm-name")');
        assert.equal(a.el('provider-company').value, provider);
    }
    a.el('provider-company').value = ' google ';
    a.run('applyProviderModelPair("provider-company")');
    assert.equal(a.el('llm-name').value, 'Gemini');
    a.el('llm-name').value = ' claude ';
    a.run('applyProviderModelPair("llm-name")');
    assert.equal(a.el('provider-company').value, 'Anthropic');
});

test('las listas completas permiten reemplazar selecciones y admiten nombres propios', () => {
    const a = app();
    a.el('provider-company').value = 'OpenAI';
    a.el('llm-name').value = 'ChatGPT';
    assert.deepEqual(Array.from(a.run('getProviderModelSuggestions("provider-company")')),
        ['Anthropic', 'OpenAI', 'Google (DeepMind)', 'Meta', 'DeepSeek', 'Alibaba']);
    assert.deepEqual(Array.from(a.run('getProviderModelSuggestions("llm-name")')),
        ['Claude', 'ChatGPT', 'Gemini', 'Llama', 'DeepSeek', 'Qwen']);
    assert.deepEqual(Array.from(a.run('getProviderModelSuggestions("llm-name", "gem")')), ['Gemini']);
    a.el('provider-company').value = 'Proveedor propio';
    assert.equal(a.run('applyProviderModelPair("provider-company")'), false);
    assert.equal(a.el('llm-name').value, 'ChatGPT');
    a.el('llm-name').value = 'Modelo propio';
    assert.equal(a.run('applyProviderModelPair("llm-name")'), false);
    assert.equal(a.el('provider-company').value, 'Proveedor propio');
});

test('cambiar el par se guarda sobre el mismo registro y se recupera completo', async () => {
    const a = app();
    complete(a);
    a.el('provider-company').value = 'OpenAI';
    a.run('applyProviderModelPair("provider-company"); markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    const id = a.records()[0].id;
    a.el('provider-company').value = 'Anthropic';
    a.run('applyProviderModelPair("provider-company"); markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    a.el('llm-name').value = 'Qwen';
    a.run('applyProviderModelPair("llm-name"); markRecordFormDirty()');
    await a.run('flushRecordAutosave()');
    assert.equal(a.records().length, 1);
    assert.equal(a.records()[0].id, id);
    assert.equal(a.records()[0].providerCompany, 'Alibaba');
    assert.equal(a.records()[0].llmName, 'Qwen');
    const b = app(a.data);
    await b.run('restoreActiveRecordDraft()');
    assert.equal(b.el('provider-company').value, 'Alibaba');
    assert.equal(b.el('llm-name').value, 'Qwen');
});

test('crear un proyecto conserva los existentes y permite reintentar una escritura fallida', async () => {
    const original = [{id: 'p1', name: 'Original'}];
    const a = app({chatlog_projects: JSON.stringify(original)});
    a.run('loadProjects = async () => {}; handleProjectSelection = async () => {};');
    a.el('new-project-container').hidden = false;
    a.el('new-project-name').value = 'Nuevo';
    a.fail('chatlog_projects');
    await a.run('addProject()');
    assert.deepEqual(JSON.parse(a.data.chatlog_projects), original);
    assert.equal((await a.run('loadFromStorage("chatlog_projects")')).length, 1);
    assert.equal(a.el('new-project-name').value, 'Nuevo');
    assert.equal(a.el('project-select').value, 'none');
    a.fail(undefined);
    await a.run('addProject()');
    assert.deepEqual(JSON.parse(a.data.chatlog_projects).map(project => project.name), ['Original', 'Nuevo']);
    assert.equal(a.el('new-project-name').value, '');
    assert.equal(a.el('project-select').value, JSON.parse(a.data.chatlog_projects)[1].id);
});

test('crear un proyecto no sustituye datos tras un error de lectura o JSON inválido', async () => {
    for (const content of ['[{"id":"p1","name":"Original"}]', '{invalid', '{}']) {
        const a = app({chatlog_projects: content});
        a.el('new-project-container').hidden = false;
        a.el('new-project-name').value = 'Nuevo';
        if (content.startsWith('[')) a.failRead('chatlog_projects');
        await a.run('addProject()');
        assert.equal(a.data.chatlog_projects, content);
        assert.equal(a.el('new-project-name').value, 'Nuevo');
        assert.equal(a.el('project-select').value, 'none');
    }
});

const auditRecord = {id: 'r1', interactionName: 'Original', llmName: 'Modelo', purpose: 'Análisis',
    prompt: 'Instrucción', dateCreated: '2026-10-01', dateModified: '2026-10-01', isImportant: false, projectId: 'p1'};
const auditProjects = [{id: 'p1', name: 'Proyecto original', dateCreated: '2026-10-01'}];

function importHarness(a) {
    a.run(`window.alerts = []; appConfirm = async () => true;
        appAlert = async (message, options) => window.alerts.push({message, options});
        loadProjects = async () => {}; loadProjectsForManagement = async () => {};
        initRecordsManagement = async () => {};`);
}

async function importFixture(a, format, mode, content) {
    const input = a.el(format === 'JSON' ? 'import-file' : 'csv-file');
    input.files = [{text: content}];
    input.value = 'archivo-seleccionado';
    a.el('import-mode').value = mode;
    await a.run(format === 'JSON' ? 'importData()' : 'importCSV()');
    await a.reads.at(-1);
    return input;
}

function jsonFixture(records = [{...auditRecord, id: 'r2', interactionName: 'Nuevo', projectId: 'p2'}]) {
    return JSON.stringify({metadata: {version: '1.0', type: 'full'}, records,
        projects: [{id: 'p2', name: 'Proyecto nuevo', dateCreated: '2026-10-01'}]});
}
const csvFixture = 'Nombre del Proyecto,Nombre de la interacción,Modelo y versión,Prompt\nProyecto nuevo,Nuevo,Modelo,Instrucción';

test('importar JSON o CSV con error conserva ambas colecciones, el formulario y el archivo', async () => {
    for (const format of ['JSON', 'CSV']) for (const mode of ['merge', 'replace']) {
        const initial = {chatlog_records: JSON.stringify([auditRecord]), chatlog_projects: JSON.stringify(auditProjects)};
        const a = app(initial); importHarness(a);
        a.fail('chatlog_records');
        a.el('record-id').value = 'r1';
        const file = await importFixture(a, format, mode, format === 'JSON' ? jsonFixture() : csvFixture);
        assert.equal(a.data.chatlog_records, initial.chatlog_records);
        assert.equal(a.data.chatlog_projects, initial.chatlog_projects);
        assert.equal(a.el('record-id').value, 'r1');
        assert.equal(file.value, 'archivo-seleccionado');
        assert.notEqual(a.run('window.alerts.at(-1).options.title'), 'Importación completada');
        assert.ok(a.writes.some(keys => keys.includes('chatlog_projects') && keys.includes('chatlog_records')));
        a.fail(undefined);
        await importFixture(a, format, mode, format === 'JSON' ? jsonFixture() : csvFixture);
        assert.equal(a.run('window.alerts.at(-1).options.title'), 'Importación completada');
        assert.equal(a.records().length, mode === 'merge' ? 2 : 1);
        assert.equal(file.value, '');
        const projectIds = new Set(JSON.parse(a.data.chatlog_projects).map(project => project.id));
        assert.ok(a.records().every(record => !record.projectId || projectIds.has(record.projectId)));
    }
});

test('las importaciones no escriben tras fallos de lectura de registros o proyectos', async () => {
    for (const key of ['chatlog_records', 'chatlog_projects']) for (const format of ['JSON', 'CSV']) {
        const a = app({chatlog_records: JSON.stringify([auditRecord]), chatlog_projects: JSON.stringify(auditProjects)});
        importHarness(a); a.failRead(key);
        await importFixture(a, format, 'replace', format === 'JSON' ? jsonFixture() : csvFixture);
        assert.equal(a.writes.length, 0);
        assert.equal(a.records()[0].id, 'r1');
        assert.notEqual(a.run('window.alerts.at(-1).options.title'), 'Importación completada');
    }
});

test('las importaciones rechazan fechas o tipos inválidos antes de escribir', async () => {
    for (const content of [jsonFixture([{...auditRecord, dateCreated: 'no es fecha'}]),
        jsonFixture([{...auditRecord, interactionDate: '2026-02-30'}]),
        jsonFixture([{...auditRecord, prompt: {texto: 'inválido'}}]), jsonFixture([null])]) {
        const a = app(); importHarness(a);
        await importFixture(a, 'JSON', 'replace', content);
        assert.equal(a.writes.length, 0);
        assert.notEqual(a.run('window.alerts.at(-1).options.title'), 'Importación completada');
    }
    const a = app(); importHarness(a);
    await importFixture(a, 'CSV', 'replace', 'Nombre,Modelo,Fecha de interacción\nPrueba,Modelo,2026-02-30');
    assert.equal(a.writes.length, 0);
});

test('duplicar, mover y marcar importantes permiten reintentar sin modificar la caché al fallar', async () => {
    for (const action of ['duplicateRecord("r1")', 'toggleRecordImportance("r1")',
        'moveRecordToProject("r1")', 'markSelectedRecordsImportant()']) {
        const a = app({chatlog_records: JSON.stringify([auditRecord]), chatlog_projects: JSON.stringify(auditProjects)});
        a.run(`loadRecordsForManagement = async () => {}; clearManagementRecordSelection = () => {};
            managementSelectedRecords.add('r1'); prompt = () => '0';`);
        a.fail('chatlog_records'); await a.run(action);
        assert.deepEqual(a.records(), [auditRecord]);
        assert.equal(JSON.stringify(await a.run('loadFromStorage("chatlog_records")')), JSON.stringify([auditRecord]));
        a.fail(undefined); await a.run(action);
        if (action.startsWith('duplicate')) assert.equal(a.records().length, 2);
        else if (action.startsWith('move')) assert.equal(a.records()[0].projectId, null);
        else assert.equal(a.records()[0].isImportant, true);
    }
});

test('borrar un proyecto guarda a la vez proyectos y asociaciones o conserva ambos si falla', async () => {
    const a = app({chatlog_records: JSON.stringify([auditRecord]), chatlog_projects: JSON.stringify(auditProjects)});
    a.run('loadProjects = async () => {};');
    a.fail('chatlog_records'); await a.run('deleteProjectById("p1")');
    assert.equal(JSON.parse(a.data.chatlog_projects).length, 1);
    assert.equal(a.records()[0].projectId, 'p1');
    a.fail(undefined); await a.run('deleteProjectById("p1")');
    assert.equal(JSON.parse(a.data.chatlog_projects).length, 0);
    assert.equal(a.records()[0].projectId, null);
});

function mockDownloadEvents(a, startFails = false, alreadyComplete = false) {
    a.run(`window.backupCount = 0; window.downloadListeners = new Set();
        markBackupCompleted = async () => { window.backupCount += 1; };
        chrome.downloads.onChanged = {
            addListener: fn => window.downloadListeners.add(fn),
            removeListener: fn => window.downloadListeners.delete(fn)
        };
        chrome.downloads.search = (query, cb) => cb(${alreadyComplete ? '[{state:"complete"}]' : '[]'});
        chrome.downloads.download = (options, cb) => {
            ${startFails ? 'chrome.runtime.lastError = {message:"Download failed"};' : ''}
            cb(${startFails ? 'undefined' : '15'});
            delete chrome.runtime.lastError;
        };`);
}
async function downloadEvent(a, state, id = 15) {
    a.run(`window.downloadListeners.forEach(fn => fn({id:${id},state:{current:${JSON.stringify(state)}}}));`);
    await new Promise(resolve => setImmediate(resolve));
}

test('JSON y CSV solo cuentan un respaldo completo cuando la descarga termina', async () => {
    for (const action of ['exportCSV()', 'exportAllData()']) {
        const a = app({chatlog_records: JSON.stringify([auditRecord]), chatlog_projects: JSON.stringify(auditProjects)});
        a.el('export-project-filter').value = 'all'; mockDownloadEvents(a);
        await a.run(action); assert.equal(a.run('window.backupCount'), 0);
        await downloadEvent(a, 'complete', 99); assert.equal(a.run('window.backupCount'), 0);
        await downloadEvent(a, 'in_progress'); assert.equal(a.run('window.backupCount'), 0);
        await downloadEvent(a, 'complete'); assert.equal(a.run('window.backupCount'), 1);
        await downloadEvent(a, 'complete'); assert.equal(a.run('window.backupCount'), 1);
    }
});

test('los respaldos JSON identifican la versión instalada y conservan su formato y alcance', async () => {
    for (const scope of ['all', 'p1', 'none']) {
        const a = app({chatlog_records: JSON.stringify([auditRecord, {...auditRecord, id: 'r2', projectId: null}]),
            chatlog_projects: JSON.stringify(auditProjects)});
        a.el('export-project-filter').value = scope;
        a.run(`chrome.runtime.getManifest = () => ({version: '2.0.2'});
            downloadJSON = data => window.exportedBackup = data;`);
        await a.run('exportAllData()');
        const backup = JSON.parse(a.run('JSON.stringify(window.exportedBackup)'));
        assert.equal(backup.metadata.appVersion, '2.0.2');
        assert.equal(backup.metadata.version, '1.0');
        assert.equal(backup.metadata.schema, 'chatlog-internal-v1');
        assert.equal(backup.metadata.scope, scope);
        assert.equal(backup.records.length, scope === 'all' ? 2 : 1);
        a.run('delete chrome.runtime.getManifest');
        await a.run('exportAllData()');
        assert.equal(a.run('window.exportedBackup.metadata.appVersion'), '2.0.1');
    }
});

test('la vista previa distingue versión de ChatLog y formato, y admite respaldos antiguos', async () => {
    for (const appVersion of [undefined, '2.0.1']) {
        const a = app();
        const backup = JSON.parse(jsonFixture());
        if (appVersion) backup.metadata.appVersion = appVersion;
        a.el('import-file').files = [{text: JSON.stringify(backup)}];
        a.run('previewJSON()');
        await a.reads.at(-1);
        assert.match(a.el('json-preview').textContent, /Formato del respaldo: 1\.0/);
        assert.equal(a.el('json-preview').textContent.includes('Creado con ChatLog 2.0.1.'), Boolean(appVersion));
        importHarness(a);
        await importFixture(a, 'JSON', 'replace', JSON.stringify(backup));
        assert.equal(a.run('window.alerts.at(-1).options.title'), 'Importación completada');
    }
});

test('descargas fallidas, interrumpidas, parciales o con cambios posteriores no reinician el recordatorio', async () => {
    for (const action of ['exportCSV()', 'exportAllData()']) for (const mode of ['failure', 'interrupted', 'partial', 'changed']) {
        const a = app({chatlog_records: JSON.stringify([auditRecord]), chatlog_projects: JSON.stringify(auditProjects)});
        a.el('export-project-filter').value = mode === 'partial' ? 'p1' : 'all';
        mockDownloadEvents(a, mode === 'failure'); await a.run(action);
        if (mode === 'changed') await a.run('saveToStorage("chatlog_records", [])');
        await downloadEvent(a, mode === 'interrupted' ? 'interrupted' : 'complete');
        assert.equal(a.run('window.backupCount'), 0);
    }
});

test('una descarga ya completada al consultar su estado también se confirma', async () => {
    const a = app({chatlog_records: JSON.stringify([auditRecord]), chatlog_projects: JSON.stringify(auditProjects)});
    a.el('export-project-filter').value = 'all'; mockDownloadEvents(a, false, true);
    await a.run('exportAllData()'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(a.run('window.backupCount'), 1);
});

test('la vista previa CSV y las tablas muestran encabezados y celdas como texto literal', async () => {
    const a = app();
    a.el('csv-file').files = [{text: '<b>Nombre</b>,__proto__\n<img src=x onerror=alert(1)>,Texto'}];
    a.run('previewCSV()'); await a.reads[0];
    const table = a.el('csv-preview').children[0];
    assert.equal(table.tagName, 'table');
    assert.equal(table.children[0].children[0].children[0].textContent, '<b>Nombre</b>');
    assert.equal(table.children[1].children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(table.children[1].children[0].children[1].textContent, 'Texto');
    a.run('buildTableWithBars("models-table", {"<b>Modelo</b>": 1}, 1, ["red"])');
    const row = a.el('#models-table tbody').children[0];
    assert.equal(row.children[0].textContent, '<b>Modelo</b>');
    assert.equal(row.children[0].children.length, 0);
    assert.equal(row.children[3].children[0].children[0].style.width, '100.0%');
});

test('fechas inválidas no impiden las estadísticas y nombres especiales se cuentan correctamente', () => {
    const a = app();
    const stats = a.run(`aggregateStatistics([
        {dateCreated:'fecha inválida',llmName:'constructor',purpose:'__proto__',projectId:'__proto__',tags:['constructor']},
        {dateCreated:'2026-02-30',llmName:'constructor',purpose:'__proto__',projectId:'__proto__'},
        {dateCreated:'2026-10-01',llmName:'',purpose:''}
    ],[{id:'__proto__',name:'constructor'}])`);
    assert.equal(stats.modelCounts.constructor, 2);
    assert.equal(stats.purposeCounts.__proto__, 2);
    assert.equal(stats.projectCounts.constructor, 2);
    assert.equal(stats.modelCounts['Modelo no especificado'], 1);
    assert.equal(stats.invalidDateCount, 2);
    assert.equal(Object.keys(stats.recordsByDate).length, 1);
    a.run('updateTimeline({}, 2)');
    assert.match(a.el('timeline-container').children[0].textContent, /2 registros.*demás conteos/);
});

test('las tres referencias de evidencia sobreviven JSON, CSV y los cuatro formatos de declaración', async () => {
    const references = [
        {evidenceType: 'url', interactionLink: 'https://example.com/conversacion'},
        {evidenceType: 'local', evidenceReference: 'Evidencias/revisión, consulta.pdf'},
        {evidenceType: 'local', evidenceReference: 'https://drive.google.com/file/d/evidencia/view?x=1&y=2'},
        {evidenceType: 'local', evidenceReference: 'https://onedrive.live.com/?id=evidencia&cid=prueba'}
    ];
    const records = references.map((evidence, index) => ({...auditRecord, id: 'e'+index,
        interactionName: 'Evidencia '+index, providerCompany: 'Proveedor', interactionDate: '2026-10-01',
        ethicalNotes: 'Revisión', biasNotes: 'Verificación humana', ...evidence}));
    const a = app({chatlog_records: JSON.stringify(records), chatlog_projects: JSON.stringify(auditProjects)});
    a.el('export-project-filter').value = 'all';
    await a.run('exportAllData()'); await a.run('exportCSV()');
    for (const [index, format] of ['JSON', 'CSV'].entries()) {
        const exported = await (await fetch(a.downloads[index].url)).text();
        URL.revokeObjectURL(a.downloads[index].url);
        const b = app(); importHarness(b);
        await importFixture(b, format, 'replace', exported);
        assert.equal(b.records().length, references.length);
        for (const [position, ref] of references.entries()) {
            const actual = b.records()[position];
            assert.equal(actual.evidenceType, ref.evidenceType);
            assert.equal(actual.evidenceReference || actual.interactionLink, ref.evidenceReference || ref.interactionLink);
        }
        b.run(`selectedRecords = ${JSON.stringify(b.records().map(record=>record.id))};
            loadQualityReviewSettings = async () => {};
            renderDeclarationPreview = text => window.output = text;`);
        b.el('include-links').checked = true;
        b.el('researcher-name').value = 'Ejemplo'; b.el('institution-name').value = 'Institución';
        for (const declarationFormat of ['standard', 'detailed', 'apa', 'aid']) {
            b.el('declaration-format').value = declarationFormat;
            await b.run('generateDeclaration()');
            for (const ref of references) assert.ok(b.run('window.output').includes(ref.evidenceReference || ref.interactionLink));
        }
    }
});

test('la vista local restaura ambas claves si localStorage falla a mitad del guardado conjunto', () => {
    const preview = fs.readFileSync(path.join(__dirname, '..', 'tools', 'preview.py'), 'utf8');
    const shim = preview.split('SHIM = r"""')[1].split('"""')[0];
    const saved = new Map([['chatlog-review:chatlog_projects', 'proyectos originales'],
        ['chatlog-review:chatlog_records', 'registros originales']]);
    let failOnce = true;
    const ctx = vm.createContext({queueMicrotask, TextEncoder, localStorage: {
        getItem: key => saved.get(key) ?? null,
        removeItem: key => saved.delete(key),
        setItem(key, value) {
            if (key.endsWith('chatlog_records') && failOnce) {failOnce = false; throw new Error('Quota exceeded');}
            saved.set(key, value);
        }
    }});
    vm.runInContext('window = this;', ctx);
    vm.runInContext(shim, ctx);
    vm.runInContext(`window.notified = 0; chrome.storage.onChanged.addListener(() => window.notified++);
        chrome.storage.local.set({chatlog_projects: 'nuevos proyectos', chatlog_records: 'nuevos registros'},
            () => window.error = chrome.runtime.lastError?.message);`, ctx);
    assert.equal(saved.get('chatlog-review:chatlog_projects'), 'proyectos originales');
    assert.equal(saved.get('chatlog-review:chatlog_records'), 'registros originales');
    assert.equal(vm.runInContext('window.notified', ctx), 0);
    assert.equal(vm.runInContext('window.error', ctx), 'Quota exceeded');
    assert.equal(vm.runInContext('chrome.runtime.lastError', ctx), undefined);
});
