"""Empaqueta únicamente los archivos necesarios de la extensión para revisión."""
import json
from pathlib import Path
import shutil
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'manifest.json').read_text())['version']
output = ROOT / 'dist' / f'ChatLog_v{version}'
archive_path = output.parent / f'{output.name}.zip'
paths = [ROOT / name for name in ('manifest.json', 'background.js', 'script.js')]
for folder in ('panel', 'icons'):
    paths.extend(path for path in (ROOT / folder).rglob('*') if path.is_file() and path.name != '.DS_Store')
paths.extend([ROOT / 'docs/privacidad/index.html', ROOT / f'manuals/Manual_Usuario_ChatLog_v{version}.pdf'])

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
