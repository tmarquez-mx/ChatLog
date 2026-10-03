"""Empaqueta únicamente los archivos necesarios de la extensión para revisión."""
import json
import argparse
import re
from pathlib import Path
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'manifest.json').read_text())['version']
output = ROOT / 'dist' / f'ChatLog_v{version}'
archive_path = output.parent / f'{output.name}.zip'
paths = [ROOT / name for name in ('manifest.json', 'background.js', 'script.js',
    'panel/index.html', 'panel/styles.css', 'icons/icon16.png', 'icons/icon32.png',
    'icons/icon48.png', 'icons/icon128.png')]
paths.extend(sorted((ROOT / 'modules').glob('*.js')))
paths.extend([ROOT / 'docs/privacidad/index.html', ROOT / f'manuals/Manual_Usuario_ChatLog_v{version}.pdf'])

for path in paths:
    if not path.is_file():
        raise SystemExit(f'Falta un archivo necesario: {path.relative_to(ROOT)}')
    if path.suffix == '.js':
        for reference in re.findall(r"(?:from\s*|import\s*\()\s*['\"](\.[^'\"]+)['\"]", path.read_text()):
            if (path.parent / reference).resolve() not in paths:
                raise SystemExit(f'Módulo no incluido: {reference} en {path.relative_to(ROOT)}')

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true', help='Validar sin generar ni modificar el ZIP')
if parser.parse_args().check:
    print(f'Paquete {version}: {len(paths)} archivos necesarios y módulos completos. No se generó un ZIP.')
    raise SystemExit(0)

output.mkdir(parents=True, exist_ok=True)
with ZipFile(archive_path, 'w', ZIP_DEFLATED) as archive:
    for path in paths:
        relative = path.relative_to(ROOT)
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        archive.write(path, relative.as_posix())
print(output)
print(archive_path)
