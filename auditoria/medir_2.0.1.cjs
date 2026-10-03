// Medición reproducible con DOM y almacenamiento simulados; no usa registros reales.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const root = process.argv[2] || path.join(__dirname, '..');
const records = Array.from({length: 5000}, (_, i) => ({
    id: `r${i}`, projectId: `p${i % 20}`, interactionName: `Interacción ${i}`,
    purpose: 'Análisis', llmName: `Modelo ${i % 4}`, providerCompany: 'Proveedor',
    prompt: 'Texto ficticio para medir el procesamiento. '.repeat(15),
    interactionLink: `https://example.com/chat/${i}`, interactionDate: '2026-10-01',
    dateCreated: '2026-10-01T10:00:00.000Z', dateModified: new Date(1750000000000 + i * 60000).toISOString(),
    ethicalNotes: 'Análisis', biasNotes: 'Verificado', tags: ['análisis', 'lectura', `etiqueta${i % 4}`]
}));
const projects = Array.from({length: 20}, (_, i) => ({id: `p${i}`, name: `Proyecto ${i}`}));
const fixture = {chatlog_records: JSON.stringify(records), chatlog_projects: JSON.stringify(projects),
    chatlog_onboarding_state: JSON.stringify({completed: true})};

async function measure() {
    let ready;
    let reads = 0;
    const elements = new Map();
    const node = () => ({value: 'all', options: [], style: {}, dataset: {}, children: [], hidden: true,
        classList: {add() {}, remove() {}, toggle() {}, contains() {return false;}},
        appendChild(child) {this.children.push(child); this.options.push(child); return child;},
        replaceChildren(...children) {this.children = children;},
        setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {}, contains() {},
        querySelector(selector) {return el(selector);}, querySelectorAll() {return [];},
        get innerHTML() {return '';}, set innerHTML(value) {this.children = []; this.options = [];},
        setCustomValidity() {}, scrollIntoView() {}
    });
    const el = id => {if (!elements.has(id)) elements.set(id, node()); return elements.get(id);};
    const chrome = {runtime: {}, storage: {local: {
        get(keys, callback) {reads++; setTimeout(() => callback(Object.fromEntries(keys.map(key => [key, fixture[key]]))), 2);},
        getBytesInUse(keys, callback) {callback(0);}, set(values, callback) {callback();}
    }}};
    const context = vm.createContext({console: {log() {}, error() {}}, URL, Date, Map, Set, Promise, Blob, Uint8Array,
        performance, setTimeout, clearTimeout, requestAnimationFrame: callback => setTimeout(callback, 0),
        document: {readyState: 'loading', documentElement: el('html'), body: el('body'),
            addEventListener(name, fn) {if (name === 'DOMContentLoaded') ready = fn;},
            getElementById: el, querySelector: el, querySelectorAll: () => [],
            createElement: node, createDocumentFragment: node},
        window: {addEventListener() {}, requestIdleCallback() {}}, chrome});
    const compileStart = performance.now();
    let loader;
    if (fs.existsSync(path.join(root, 'modules/runtime.js'))) {
        loader = require('../tests/helpers/esm-loader.cjs').moduleLoader(context, root);
        await loader.load('script.js');
    } else vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), context);
    const compileMs = performance.now() - compileStart;
    const start = performance.now();
    await ready();
    const readyMs = performance.now() - start;
    const domain = loader ? (await loader.load('modules/records.js')).namespace : context;
    const stats = loader ? (await loader.load('modules/statistics.js')).namespace : context;
    const duplicateStart = performance.now();
    const duplicateMap = domain.buildDuplicateRecordMap(records);
    const duplicatesMs = performance.now() - duplicateStart;
    const statsStart = performance.now();
    stats.aggregateStatistics(records, projects);
    const statisticsMs = performance.now() - statsStart;
    return {compileMs, readyMs, reads, duplicatesMs, statisticsMs, duplicateCount: duplicateMap.size};
}

(async () => {
    await measure();
    const samples = [];
    for (let i = 0; i < 7; i++) samples.push(await measure());
    const result = Object.fromEntries(Object.keys(samples[0]).map(key => [key,
        Number(samples.map(sample => sample[key]).sort((a, b) => a - b)[3].toFixed(2))]));
    console.log(JSON.stringify({records: records.length, storageLatencyMs: 2, samples: 7, median: result}, null, 2));
})().catch(error => {console.error(error); process.exitCode = 1;});
