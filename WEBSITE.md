# Sitio promocional de ChatLog

El sitio está en `website/`, separado de los archivos históricos del repositorio
y de la extensión. Es HTML, CSS y JavaScript estáticos, sin compilación.

## Publicación

- Sitio: https://chatlog-ext.netlify.app
- Repositorio: https://github.com/tmarquez-mx/ChatLog
- Directorio publicado: `website`, declarado en `netlify.toml`.
- La rama de producción debe ser `main`.
- No publicar el directorio raíz: contiene documentación y archivos históricos.

## Contenido y privacidad

La demo ofrece tres casos ficticios: ensayo, preparación de clase e investigación.
Permite editar un registro y generar, copiar o descargar una declaración
ilustrativa. No se conecta a un LLM ni a la extensión. Los datos del formulario
solo viven en memoria durante la visita. No se incluye analítica ni almacenamiento
persistente. Los enlaces de instalación, manual y asistentes conducen a servicios
externos. La política de privacidad de la extensión se enlaza en navegación,
sección de privacidad y pie de página:
https://tmarquez-mx.github.io/ChatLog/privacidad/

Las capturas de `website/assets/` muestran la interfaz V2 con datos ficticios,
no registros personales. El ícono conserva el recurso original de ChatLog.
Las fuentes Literata y Manrope se alojan localmente con sus licencias OFL.

## Revisión antes de publicar

1. Servir `website/` con un servidor estático local.
2. Probar los tres casos, cambios de formulario y campos vacíos.
3. Comprobar que copiar y descargar se deshabilitan hasta regenerar el texto.
4. Revisar la descarga `.txt`, la galería y todos los enlaces externos.
5. Verificar escritorio y móvil, navegación con teclado y movimiento reducido.
6. Confirmar que no hay errores de JavaScript ni recursos ausentes.

La demo no certifica integridad académica ni cumplimiento editorial. Sus textos
deben adaptarse a las reglas del curso, institución o publicación.

## Versión del repositorio

El código fuente y el manual corresponden a la 2.0.1 en revisión; Chrome Web Store mantiene la 2.0.0 hasta su actualización. El sitio enlaza el manual local `website/assets/Manual_Usuario_ChatLog_v2.0.1.pdf` y la política de GitHub Pages. La demo y sus ejemplos conservan su comportamiento ilustrativo.
