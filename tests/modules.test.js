const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const {moduleLoader} = require('./helpers/esm-loader.cjs');
const root = path.join(__dirname, '..');

async function application(initial = {}) {
    const data = {...initial, chatlog_onboarding_state: JSON.stringify({completed: true})};
    const elements = new Map();
    const readCalls = [];
    const writes = [];
    const changeListeners = [];
    let ready;
    let delayedRead;
    let delayReads = false;
    let failReads = false;
    function node(tag = 'div') {
        const classes = new Set();
        return {tagName: tag, children: [], options: [], attributes: {}, listeners: {}, value: 'all',
            hidden: true, style: {}, dataset: {}, inert: false,
            classList: {add(...values) {values.forEach(value => classes.add(value));},
                remove(...values) {values.forEach(value => classes.delete(value));},
                contains(value) {return classes.has(value);},
                toggle(value, force) {const add = force ?? !classes.has(value); add ? classes.add(value) : classes.delete(value); return add;}},
            appendChild(child) {if (child.tagName === '#fragment') this.children.push(...child.children); else this.children.push(child); this.options.push(child); return child;},
            replaceChildren(...children) {this.children = children;},
            addEventListener(name, fn) {(this.listeners[name] ||= []).push(fn);},
            setAttribute(name, value) {this.attributes[name] = value;}, getAttribute(name) {return this.attributes[name];},
            removeAttribute(name) {delete this.attributes[name];},
            querySelector(selector) {return el(selector);}, querySelectorAll() {return [];},
            get innerHTML() {return '';}, set innerHTML(value) {this.children = []; this.options = [];},
            focus() {}, contains() {}, setCustomValidity() {}, scrollIntoView() {}
        };
    }
    const el = id => {if (!elements.has(id)) elements.set(id, node()); return elements.get(id);};
    const storage = {onChanged: {addListener(fn) {changeListeners.push(fn);}}, local: {
        get(keys, cb) {readCalls.push(keys); const result = Object.fromEntries(keys.map(key => [key, data[key]]));
            const deliver = () => {
                if (failReads) chrome.runtime.lastError = {message: 'Fallo de lectura simulado'};
                try {cb(result);} finally {delete chrome.runtime.lastError;}
            };
            if (delayReads) delayedRead = deliver; else queueMicrotask(deliver);},
        set(values, cb) {writes.push(values); Object.assign(data, values); queueMicrotask(() => {
            cb(); changeListeners.forEach(fn => fn(Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, {newValue}])), 'local'));
        });},
        getBytesInUse(keys, cb) {cb(0);}
    }};
    const chrome = {runtime: {}, storage};
    const context = vm.createContext({console, performance, URL, Date, Map, Set, WeakMap, Promise, Blob, Uint8Array,
        chrome,
        setTimeout(fn, delay) {const timer = setTimeout(fn, delay); timer.unref(); return timer;}, clearTimeout,
        window: {addEventListener() {}, requestIdleCallback() {}},
        document: {documentElement: el('html'), body: el('body'),
            addEventListener(name, fn) {if (name === 'DOMContentLoaded') ready = fn;},
            getElementById: el, querySelector: el, querySelectorAll: () => [],
            createElement: node, createDocumentFragment: () => node('#fragment'), createTextNode: text => ({textContent: text})}
    });
    const loader = moduleLoader(context, root);
    const entry = (await loader.load('script.js')).namespace;
    return {loader, entry, data, el, readCalls, writes, start: () => ready(),
        failRead(value = true) {failReads = value;},
        delay() {delayReads = true;}, reply() {delayedRead();},
        change(key, newValue) {data[key] = newValue; changeListeners.forEach(fn => fn({[key]: {newValue}}, 'local'));}};
}

test('la carga ESM inicial excluye las tres pestañas secundarias y comparte cada módulo una sola vez', async () => {
    const app = await application();
    assert.equal(app.loader.modules.size, 4);
    await app.start();
    assert.equal(app.readCalls.length, 1);
    assert.equal(app.el('html').dataset.appReady, 'true');
    assert.equal(app.el('main').inert, false);
    await Promise.all([app.entry.ensureFeature('stats'), app.entry.ensureFeature('stats')]);
    const filenames = [...app.loader.modules.keys()].map(file => path.basename(file));
    assert.equal(filenames.filter(file => file === 'statistics.js').length, 1);
    assert.ok(!filenames.includes('declaration.js') && !filenames.includes('management.js') && !filenames.includes('transfer.js'));
    await app.entry.ensureFeature('declaration');
    await app.entry.ensureFeature('tools');
    assert.ok([...app.loader.modules.keys()].some(file => file.endsWith('/transfer.js')));
});

test('recuperación y ajustes conservan la revisión de estadísticas; una colección cambia una sola vez', async () => {
    const app = await application({chatlog_records: '[]', chatlog_projects: '[]'});
    const store = (await app.loader.load('modules/storage.js')).namespace;
    const {appState} = (await app.loader.load('modules/runtime.js')).namespace;
    await store.preloadStorage(['chatlog_records', 'chatlog_projects']);
    const revision = appState.storageRevision;
    const stats = appState.statisticsDataCache = {revision};
    await store.saveToStorage('chatlog_active_record_draft', {text: 'Borrador'}, {countBackupChange: false});
    assert.equal(appState.storageRevision, revision);
    assert.equal(appState.statisticsDataCache, stats);
    await store.saveToStorage('chatlog_records', [{id: 'r1'}], {countBackupChange: false});
    assert.equal(appState.storageRevision, revision + 1);
    assert.equal(appState.statisticsDataCache, null);
    const writeCount = app.writes.length;
    await store.saveToStorage('chatlog_records', [{id: 'r1'}], {countBackupChange: false});
    assert.equal(app.writes.length, writeCount);
});

test('una lectura iniciada antes de un cambio externo no sustituye los datos nuevos', async () => {
    const app = await application({chatlog_records: JSON.stringify([{id: 'anterior'}])});
    const store = (await app.loader.load('modules/storage.js')).namespace;
    app.delay();
    const read = store.loadFromStorage('chatlog_records');
    app.change('chatlog_records', JSON.stringify([{id: 'actual'}]));
    app.reply();
    assert.equal((await read)[0].id, 'actual');
});

test('los proyectos cerrados y los detalles no crean fichas hasta abrirse y muestran texto literal', async () => {
    const record = {id: 'r1', projectId: 'p1', interactionName: 'Prueba', llmName: 'Modelo',
        prompt: 'Texto', purpose: 'Análisis', interactionLink: 'https://example.com/chat', dateModified: '2026-10-01'};
    const app = await application({chatlog_projects: JSON.stringify([{id: 'p1', name: '<b>Proyecto</b>'}]),
        chatlog_records: JSON.stringify([record, {...record, id: 'r2'}])});
    await app.start();
    await app.entry.ensureFeature('tools');
    const tools = (await app.loader.load('modules/management.js')).namespace;
    app.el('records-tags-filter').value = '';
    app.el('records-search-filter').value = '';
    app.el('records-sort-by').value = 'date-desc';
    await tools.loadRecordsForManagement();
    const group = app.el('records-by-project').children[0];
    const [header, list] = group.children;
    assert.equal(header.children[0].textContent, '<b>Proyecto</b>');
    assert.equal(list.children.length, 0);
    header.listeners.click[0]();
    assert.equal(list.children.length, 2);
    const row = list.children[0];
    assert.equal(row.children.length, 3);
    const detail = row.children[2].children.find(child => child.textContent === 'Ver detalles');
    detail.listeners.click[0]({stopPropagation() {}});
    assert.equal(row.children.length, 4);
    detail.listeners.click[0]({stopPropagation() {}});
    assert.equal(row.children.length, 4);
    header.listeners.click[0](); header.listeners.click[0]();
    assert.equal(list.children.length, 2);
});

test('la selección reciente conserva importancia, fecha, filtros y orden estable sin ordenar los originales', async () => {
    const app = await application();
    const domain = (await app.loader.load('modules/records.js')).namespace;
    const records = [{id: 'old', dateModified: '2025-01-01', isImportant: true, projectId: 'p1'},
        {id: 'new', dateModified: '2026-10-01', projectId: 'p1'},
        {id: 'tie', dateModified: '2026-10-01'}, {id: 'invalid', dateModified: 'no-fecha'}];
    assert.deepEqual(Array.from(domain.selectRecentRecords(records), r => r.id), ['old', 'new', 'tie', 'invalid']);
    assert.deepEqual(Array.from(domain.selectRecentRecords(records, 'none'), r => r.id), ['tie', 'invalid']);
    assert.deepEqual(Array.from(domain.selectRecentRecords(records, 'p1', 1), r => r.id), ['old']);
    assert.equal(records[0].id, 'old');
    assert.equal(records[1].id, 'new');
});

test('la caché de calidad se invalida al cambiar las reglas o reemplazar el registro', async () => {
    const app = await application();
    const domain = (await app.loader.load('modules/records.js')).namespace;
    const {appState} = (await app.loader.load('modules/runtime.js')).namespace;
    const record = {interactionName: 'Prueba', purpose: 'Análisis', llmName: 'Modelo', prompt: 'Texto', interactionLink: 'https://example.com'};
    const first = domain.evaluateRecordQuality(record);
    assert.equal(domain.evaluateRecordQuality(record), first);
    appState.qualityRules = {requireDate: false, requireProvider: false, requireStage: false, requireVerification: false, requireProject: false};
    assert.equal(domain.evaluateRecordQuality(record).status, 'ready');
    assert.equal(domain.evaluateRecordQuality({...record, prompt: ''}).status, 'incomplete');
});

test('la búsqueda comparte su análisis hasta cambiar registros, proyectos o criterios', async () => {
    const app = await application();
    await app.entry.ensureFeature('tools');
    const tools = (await app.loader.load('modules/management.js')).namespace;
    const {appState} = (await app.loader.load('modules/runtime.js')).namespace;
    const records = [{id: 'r1', interactionName: 'Texto'}];
    const first = tools.getManagementAnalysis(records, []);
    assert.equal(tools.getManagementAnalysis(records, []), first);
    assert.equal(first.qualityCounts.incomplete, 1);
    assert.notEqual(tools.getManagementAnalysis([...records], []), first);
    const second = tools.getManagementAnalysis(records, []);
    appState.qualityRules = {...appState.qualityRules, requireDate: false};
    assert.notEqual(tools.getManagementAnalysis(records, []), second);
    const third = tools.getManagementAnalysis(records, []);
    assert.notEqual(tools.getManagementAnalysis(records, [{id: 'p1', name: 'Proyecto'}]), third);
});

test('un fallo al leer la recuperación conserva los datos y bloquea la captura inicial', async () => {
    const app = await application({chatlog_records: '[{"id":"r1"}]', chatlog_active_record_draft: '{inválido'});
    await app.start();
    assert.equal(app.el('html').dataset.appReady, 'error');
    assert.equal(app.el('main').inert, true);
    assert.equal(app.data.chatlog_active_record_draft, '{inválido');
    assert.equal(app.writes.length, 0);
});

test('el reintento recupera la carga tras un fallo sin repetir eventos ni lecturas simultáneas', async () => {
    const initial = {chatlog_records: '[{"id":"r1","prompt":"Texto conservado"}]',
        chatlog_projects: '[{"id":"p1","name":"Proyecto conservado"}]'};
    const app = await application(initial);
    app.failRead();
    await app.start();
    assert.equal(app.el('startup-status').hidden, false);
    assert.match(app.el('startup-status-message').textContent, /proteger tus registros/);
    assert.equal(app.el('main').inert, true);
    assert.equal(app.el('retry-load-btn').disabled, false);
    const {appState} = (await app.loader.load('modules/runtime.js')).namespace;
    assert.equal(appState.appStatusTimer, null); // El error inicial no tiene un temporizador de ocultación.

    app.el('interaction-name').value = 'Texto en el formulario';
    app.failRead(false);
    app.delay();
    const retry = app.el('retry-load-btn').listeners.click[0]();
    assert.equal(app.entry.startApp(), retry);
    assert.equal(app.el('retry-load-btn').disabled, true);
    assert.equal(app.el('main').attributes['aria-busy'], 'true');
    assert.equal(app.readCalls.length, 2);
    app.reply();
    await retry;
    assert.equal(app.el('html').dataset.appReady, 'true');
    assert.equal(app.el('startup-status').hidden, true);
    assert.equal(app.el('main').inert, false);
    assert.equal(app.el('interaction-name').value, 'Texto en el formulario');
    for (const id of ['retry-load-btn', 'add-project-btn', 'new-record-btn']) {
        assert.equal(app.el(id).listeners.click.length, 1);
    }
    assert.equal(app.el('record-form').listeners.input.length, 1);
    assert.equal(app.data.chatlog_records, initial.chatlog_records);
    assert.equal(app.data.chatlog_projects, initial.chatlog_projects);
    assert.equal(app.writes.length, 0);
    await app.entry.startApp();
    assert.equal(app.readCalls.length, 2);
});

test('reintentar relee colecciones inválidas y mantiene el aviso si vuelve a fallar', async () => {
    const app = await application({chatlog_projects: '{}', chatlog_records: '[{"id":"r1"}]'});
    await app.start();
    const retry = app.el('retry-load-btn').listeners.click[0];
    app.failRead();
    await retry();
    assert.equal(app.el('html').dataset.appReady, 'error');
    assert.equal(app.el('startup-status').hidden, false);
    assert.equal(app.el('retry-load-btn').disabled, false);
    assert.equal(app.el('main').inert, true);
    assert.equal(app.writes.length, 0);
    app.failRead(false);
    app.data.chatlog_projects = '[{"id":"p1","name":"Proyecto recuperado"}]';
    await retry();
    assert.equal(app.el('html').dataset.appReady, 'true');
    assert.equal(app.readCalls.length, 3);
    const {appState} = (await app.loader.load('modules/runtime.js')).namespace;
    assert.equal(appState.storageCache.get('chatlog_projects')[0].name, 'Proyecto recuperado');
    assert.equal(app.writes.length, 0);
});

test('el icono configura la apertura nativa del panel con manejo de errores y sin un manejador de clic', async () => {
    const calls = [];
    const errors = [];
    vm.runInNewContext(fs.readFileSync(path.join(root, 'background.js'), 'utf8'), {
        chrome: {sidePanel: {setPanelBehavior(options) {calls.push(options); return Promise.reject(new Error('Prueba de fallo'));}}},
        console: {error(...args) {errors.push(args);}}
    });
    await Promise.resolve();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].openPanelOnActionClick, true);
    assert.equal(errors.length, 1);
});
