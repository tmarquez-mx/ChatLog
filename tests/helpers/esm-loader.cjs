const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function moduleLoader(context, root) {
    const modules = new Map();
    function get(file) {
        const absolute = path.resolve(root, file);
        if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('Módulo fuera del proyecto');
        if (!modules.has(absolute)) {
            modules.set(absolute, new vm.SourceTextModule(fs.readFileSync(absolute, 'utf8'), {
                context, identifier: absolute,
                importModuleDynamically: async (specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier))
            }));
        }
        return modules.get(absolute);
    }
    const linker = (specifier, parent) => get(path.resolve(path.dirname(parent.identifier), specifier));
    async function load(file) {
        const module = get(file);
        if (module.status === 'unlinked') await module.link(linker);
        if (module.status === 'linked') await module.evaluate();
        return module;
    }
    return {load, modules};
}

module.exports = {moduleLoader};
