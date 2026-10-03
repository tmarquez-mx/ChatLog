const fs = require('node:fs');
const path = require('node:path');

// El simulador usa los mismos cuerpos de función. La carga ESM real se verifica
// por separado, sin transformar imports, además de las pruebas del navegador.
function loadSource(root) {
    const files = ['modules/runtime.js', 'modules/records.js', 'modules/storage.js',
        'modules/import-data.js', 'modules/downloads.js', 'modules/declaration.js',
        'modules/statistics.js', 'modules/transfer.js', 'modules/management.js', 'script.js'];
    const source = files.map(file => fs.readFileSync(path.join(root, file), 'utf8')
        .replace(/^import .*;\s*$/gm, '')
        .replace(/^export \{[\s\S]*?\};\s*$/gm, '')
        .replace(/^export (?=(?:const|let|function|async function) )/gm, '')).join('\n');
    const functions = [...source.matchAll(/^(?:async )?function (\w+)\(/gm)].map(match => match[1]);
    return source + `\nObject.assign(ui, {${functions.join(', ')}});
        Object.keys(appState).forEach(name => Object.defineProperty(globalThis, name, {
            configurable: true, get: () => appState[name], set: value => appState[name] = value
        }));
        ${JSON.stringify(functions)}.forEach(name => Object.defineProperty(globalThis, name, {
            configurable: true, get: () => ui[name], set: value => ui[name] = value
        }));`;
}

module.exports = {loadSource};
