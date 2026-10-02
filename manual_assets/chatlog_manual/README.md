# Actualizar el manual 2.0.1

`update_manual.py` parte de `manuals/Manual_Usuario_ChatLog_v2.0.0.docx`, conserva sus estilos y componentes, actualiza instrucciones y numeración e incorpora las capturas nuevas de inicio, borrador y Sobre. El original permanece disponible.

Ejecuta ese script con Python y `lxml`, y renderiza el Word resultante para revisar todas sus páginas antes de exportar el PDF. El script `build_manual.py` conserva la construcción original como referencia.

El PDF verificado se copia a `manuals/`, `docs/` y `website/assets/` para que los enlaces incluidos en la extensión y el sitio funcionen. La política de `docs/privacidad/index.html` se replica en `privacidad/index.html` para GitHub Pages; el sitio promocional enlaza esta página pública.
