# Revisión local de ChatLog 2.0.1

Este repositorio contiene la versión 2.0.1 para revisión. La actualización de Chrome Web Store está pendiente. La política pública está en `https://tmarquez-mx.github.io/ChatLog/privacidad/`.

## Revisar la extensión

Ejecuta `python3 tools/package_extension.py` para generar una copia lista para cargar en `dist/ChatLog_v2.0.1/` y un ZIP con únicamente los archivos de la extensión. La vista en `http://127.0.0.1:8765/panel/index.html` usa datos de prueba; para volver a abrirla ejecuta `python3 tools/preview.py`.

1. Exporta un respaldo JSON desde tu extensión actual.
2. Para conservar los datos, recarga la instalación de desarrollo existente desde la misma carpeta. No desinstales la extensión publicada para probar este proyecto: una copia de desarrollo tiene almacenamiento independiente.
3. En `chrome://extensions`, activa el modo desarrollador y carga esta carpeta si aún no está cargada. Comprueba «Sobre»: 2.0.1.
4. Escribe solo el nombre de una interacción. Espera «Borrador guardado · faltan campos» y vuelve a abrir el panel. Comprueba que se recupere.
5. Completa los campos y comprueba «Guardado». Edita el mismo registro varias veces y verifica que no haya duplicados.
6. Pulsa «Nuevo registro»: el anterior permanece y el formulario queda vacío. Cambia de pestaña o abre otro registro durante la captura y comprueba su conservación.
7. Abre Herramientas: los borradores muestran los campos pendientes. Prueba exportar JSON e importar en una instalación de prueba; conserva el respaldo original.
8. Revisa la política de privacidad y el manual desde «Sobre».
9. En Referencia de la interacción, elige Archivo de evidencia conservada y escribe una ubicación relativa al proyecto. Completa los demás campos y comprueba que no se solicite una URL. Abre la ayuda sobre cómo recoger evidencia.
10. Genera una declaración y verifica que la ubicación se identifique como Evidencia conservada. Exporta CSV y JSON e impórtalos en una instalación de prueba para comprobar que se conserve la referencia.
11. Pasa el mouse por los botones JSON y CSV, o enfócalos con Tab, y revisa sus explicaciones. Escape cierra la ayuda.
12. En Empresa proveedora y Nombre del LLM, usa la flecha para cambiar una selección sin borrar el texto. Comprueba los seis pares de la tabla en ambos sentidos y el guardado del cambio sobre el mismo registro. Los nombres fuera de la lista siguen siendo editables.
13. Para un archivo de evidencia en Google Drive o OneDrive, selecciona Archivo de evidencia conservada y pega la URL en Nombre y ubicación del archivo. La ayuda del campo y el manual aclaran que ChatLog conserva la referencia, no incluye el archivo ni comprueba sus permisos de acceso.

Antes de generar un nuevo ZIP, terminar los ajustes y consultar a Teresa si hay algún cambio más para incluir.

## Publicar en Chrome Web Store después de la revisión

GitHub Pages conserva su configuración existente: rama `main`, directorio raíz. La carpeta `/privacidad` sirve la política pública; `/docs/privacidad` contiene la copia incluida en la extensión. Ambas deben tener el mismo contenido.

Comprobar que `https://tmarquez-mx.github.io/ChatLog/privacidad/` responda antes de sustituir la URL de privacidad en Chrome Web Store. La extensión abre la misma política incluida localmente, por lo que funciona durante la revisión y sin conexión. El sitio promocional enlaza la política pública de GitHub Pages.

Activar las analíticas siguiendo [ANALITICAS.md](ANALITICAS.md). No se incluye un identificador ficticio ni datos de demostración en los reportes.

## Resultados de la revisión

Teresa verificó el guardado automático, la ausencia de duplicados, «Nuevo registro», la versión en la declaración, las ayudas y los documentos. Queda pendiente su revisión de los dos tipos de evidencia y de las sugerencias de empresa y LLM. Los encabezados de Estadísticas se corrigieron y se comprobaron al desplazarse.

Ante el aviso de error al crear proyectos en la vista local, se comprobó la creación en Chrome y en el navegador integrado; no se reprodujo el fallo informado. Se corrigió el reintento tras una escritura fallida: la lista en memoria permanece intacta hasta confirmar el guardado. También se impide reemplazar proyectos cuando su lectura falla o su formato no es válido. El aviso de escritura muestra ahora la causa comunicada por el almacenamiento.

Las cuatro correcciones posteriores de la auditoría están aplicadas al código local: importaciones sin falso éxito ni guardados separados de proyectos/registros; operaciones que conservan la caché ante fallos; respaldos que esperan una descarga completa y no cuentan exportaciones parciales; estadísticas que toleran fechas antiguas inválidas y presentan literalmente el texto importado. Los siete fallos reproducibles de la auditoría original quedan cubiertos por pruebas de regresión.

Pasan 35 pruebas automatizadas. Incluyen fallos y reintentos, referencias web/archivos locales/Drive/OneDrive en JSON y CSV, y los cuatro formatos de declaración. En el navegador se importaron cuatro registros ficticios y se comprobaron sus estadísticas, incluido un nombre con etiquetas HTML que se muestra como texto. El informe [Auditoria_ChatLog_2.0.1.txt](auditoria/Auditoria_ChatLog_2.0.1.txt) distingue el estado corregido de los hallazgos históricos y de las propuestas de eficiencia.

La confirmación de la descarga se escucha con el panel abierto; si se cierra antes de confirmarla, el recordatorio sigue pendiente. La vista local no confirma el final de las descargas y no reinicia el recordatorio.

El 2 de octubre de 2026, por petición de Teresa, se generó el primer `dist/ChatLog_v2.0.1.zip` con las correcciones. Se verificaron sus 11 archivos, su integridad, las referencias locales y la coincidencia exacta del manifiesto 2.0.1 con el del proyecto. Fue sustituido después por el paquete modularizado descrito al final de esta guía. Chrome Web Store sigue pendiente.

## Revisión local posterior: modularización y rapidez

La reorganización posterior conserva 2.0.1 y sus permisos. La entrada carga formulario, almacenamiento y reglas de registros; las secciones secundarias tienen módulos que se cargan al seleccionarlas. Las lecturas iniciales se agrupan, las búsquedas conservan su análisis y las fichas de proyectos cerrados se construyen al desplegarlos. El icono configura la apertura nativa del panel; el manifiesto declara Chrome 116 como mínimo.

Pasan 44 pruebas, incluido el grafo ESM real y los casos de fallo anteriores. Se verificaron en el navegador la búsqueda, despliegue, detalles, guardado al cambiar de pestaña, declaración de 150 registros y estadísticas. El [informe de eficiencia](auditoria/Auditoria_eficiencia_2.0.1.txt) contiene el antes/después y distingue inicialización de datos de apertura completa desde la barra.

Recargar la vista local para probar esta reorganización. Revisar que Acceso rápido conserve el orden, que Herramientas despliegue los registros al abrir un proyecto, que las búsquedas y acciones de selección funcionen y que el borrador se conserve al cambiar de sección. Después de preparar un nuevo paquete, probar también el clic en el icono de Chrome.

`python3 tools/package_extension.py --check` valida los 20 archivos necesarios y sus módulos sin generar ZIP. El ZIP original de 11 archivos correspondía a la copia previa a esta reorganización; el paquete actual incluye los módulos. Se consultó a Teresa antes de generarlo y lo autorizó.

## Recuperación de apertura y versión del respaldo

El error de carga inicial permanece visible y ofrece «Reintentar». Durante el reintento la captura y el botón están deshabilitados; se releen los datos sin repetir los eventos de los controles. Si vuelve a fallar, el aviso permanece y los registros almacenados se conservan. Cuando termina correctamente, se retira el aviso y se habilita la captura.

Los JSON exportados incluyen `metadata.appVersion`, obtenida de la versión instalada de ChatLog. `metadata.version` sigue siendo `1.0`, porque identifica el formato del respaldo. La vista previa distingue ambos datos; los archivos antiguos sin `appVersion` se siguen importando.

Pasan 48 pruebas. Las cuatro nuevas cubren recuperación después de un fallo, reintentos simultáneos y repetidos sin duplicar eventos, versión y alcance del JSON, vista previa e importación de respaldos antiguos/nuevos. Se comprobó el aviso persistente y su recuperación en el navegador con datos ficticios y un fallo de lectura inicial simulado. Estos ajustes están incluidos en el nuevo ZIP autorizado por Teresa.

## Paquete actual para probar desde Chrome

Se regeneró `dist/ChatLog_v2.0.1.zip` por petición de Teresa. Contiene 20 archivos y 602,554 bytes. Se verificaron la integridad del ZIP, todas las referencias locales y la igualdad exacta de sus archivos con el código fuente y la carpeta `dist/ChatLog_v2.0.1/`. El manifiesto coincide exactamente: versión 2.0.1, Chrome mínimo 116 y permisos storage, sidePanel y downloads.

SHA256: `32ee020f00b2ef4f488f35a53f087736f125f40d654977c49cd393df98b9b24d`.

Las [instrucciones de prueba desde la barra de Chrome](PRUEBA_2.0.1.md) explican cómo generar el paquete desde el repositorio e instalarlo. Las instrucciones entregadas junto al ZIP están en `dist/Instrucciones_prueba_ChatLog_2.0.1.txt`; `dist/` contiene archivos locales y no se publica en GitHub. Falta verificar la apertura desde el icono en la instalación de desarrollo de Chrome. No se publicó en Chrome Web Store.
