# Probar ChatLog 2.0.1 desde la barra de Chrome

Esta versión del repositorio incluye las correcciones de la auditoría, la reorganización en módulos y los ajustes de recuperación y respaldos. La publicación en Chrome Web Store se realiza por separado.

## Preparar e instalar

1. Descarga este repositorio desde **Code → Download ZIP**, descomprímelo o clónalo. Conserva la carpeta durante las pruebas.
2. Para crear el paquete de la extensión, ejecuta `python3 tools/package_extension.py` desde esa carpeta. Genera `dist/ChatLog_v2.0.1.zip` y la carpeta `dist/ChatLog_v2.0.1/` con únicamente los archivos necesarios.
3. Abre `chrome://extensions`, activa **Modo desarrollador** y pulsa **Cargar descomprimida**. Selecciona `dist/ChatLog_v2.0.1/`, donde está `manifest.json`. También puedes cargar directamente la carpeta raíz del repositorio.
4. Abre el menú de extensiones de Chrome y fija esta copia de ChatLog con la chincheta. Si tienes dos copias, identifica la de desarrollo en `chrome://extensions`.
5. Pulsa su icono para abrir el panel lateral. En **Sobre**, comprueba **2.0.1**. Cierra y vuelve a abrir el panel varias veces para revisar su rapidez y recuperación.

El manifiesto declara Chrome 116 como mínimo. La copia de desarrollo y la vista local tienen almacenamiento independiente de la extensión instalada desde la tienda. Exporta un respaldo JSON desde tu instalación actual antes de probar; no hace falta desinstalarla.

## Qué comprobar

- Crea un proyecto de prueba o importa una copia de tu respaldo JSON desde **Herramientas**.
- Escribe un registro incompleto y espera **Borrador guardado · faltan campos**. Cierra y abre el panel, completa el registro y comprueba que conserve un solo identificador. Prueba **Nuevo registro**.
- Prueba los enlaces web y las referencias a archivos, incluidas las URL de Google Drive o OneDrive. Genera declaraciones y comprueba que identifiquen el tipo de evidencia y la versión de ChatLog.
- Cambia empresa y modelo con sus listas; verifica los pares, la edición libre y el guardado sobre el mismo registro.
- En **Herramientas**, despliega un proyecto, abre detalles, busca y revisa las acciones de selección. Revisa el desplazamiento de las tablas en **Estadísticas**.
- Exporta JSON y selecciónalo para ver su vista previa: debe indicar **Creado con ChatLog 2.0.1** y **Formato del respaldo: 1.0**. Comprueba también la importación de un respaldo anterior.
- Si falla la carga inicial, el aviso debe permanecer visible y ofrecer **Reintentar**. Se verificó con un fallo simulado; no modifiques ni borres tus registros para provocar el error.
- Abre el manual y la política de privacidad desde **Sobre**.

Mantén la carpeta de esta copia en el mismo lugar para conservar sus datos. Para actualizarla, exporta antes un respaldo JSON, reemplaza los archivos de esa carpeta y pulsa **Recargar** en su tarjeta de `chrome://extensions`.

## Comprobación y vista local

`npm test` ejecuta 48 pruebas con almacenamiento simulado. `python3 tools/package_extension.py --check` valida los archivos y módulos sin generar el ZIP.

Para revisar la interfaz en el navegador, ejecuta `python3 tools/preview.py` y abre `http://127.0.0.1:8765/panel/index.html`. Esta vista conserva datos de prueba independientes y no sustituye la prueba de apertura desde el icono de Chrome.
