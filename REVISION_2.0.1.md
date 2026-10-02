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

## Publicar en Chrome Web Store después de la revisión

GitHub Pages conserva su configuración existente: rama `main`, directorio raíz. La carpeta `/privacidad` sirve la política pública; `/docs/privacidad` contiene la copia incluida en la extensión. Ambas deben tener el mismo contenido.

Comprobar que `https://tmarquez-mx.github.io/ChatLog/privacidad/` responda antes de sustituir la URL de privacidad en Chrome Web Store. La extensión abre la misma política incluida localmente, por lo que funciona durante la revisión y sin conexión. El sitio promocional enlaza la política pública de GitHub Pages.

Activar las analíticas siguiendo [ANALITICAS.md](ANALITICAS.md). No se incluye un identificador ficticio ni datos de demostración en los reportes.

## Resultados de la revisión

Teresa verificó el guardado automático, la ausencia de duplicados, «Nuevo registro», la versión en la declaración, las ayudas y los documentos. Queda pendiente su revisión de los dos tipos de evidencia y de las sugerencias de empresa y LLM. Los encabezados de Estadísticas se corrigieron y se comprobaron al desplazarse.
