// Regresiones funcionales y grafo ESM real, con datos ficticios.
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--test',
    path.join(__dirname, '../tests/chatlog.test.js'), path.join(__dirname, '../tests/modules.test.js')], {stdio: 'inherit'});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
