<div align="center">
<img src="icons/icon128.png" width="96" alt="Icono de ChatLog">

# ChatLog 2.0.1

**Registra. Organiza. Declara.**

Bitácora para documentar el uso académico de modelos de lenguaje.

[Instalar desde Chrome Web Store](https://chromewebstore.google.com/detail/chatlog/faipejgfejnoaigphcdbdeppgjmdaobn)
</div>

ChatLog organiza interacciones por proyecto y genera declaraciones de uso de IA. Registra finalidad, herramienta, versión, prompt, evidencia, etapa del trabajo y verificación humana. La responsabilidad intelectual permanece en la persona autora. La publicación de esta actualización en Chrome Web Store se tramita por separado.

## Cambios de 2.0.1

- Guardado automático de registros y borradores, con recuperación al reabrir el panel y reintento ante errores de carga.
- Evidencia mediante enlace de conversación o referencia de un archivo conservado en el equipo, Google Drive o OneDrive. Sirve también para interacciones en aplicaciones de escritorio; ChatLog no adjunta ni respalda esos archivos.
- Selección vinculada de empresa y modelo, con edición libre y posibilidad de cambiar la selección sin borrar el texto.
- Declaraciones estándar y detalladas con la versión de ChatLog; respaldo JSON con identificación de la versión instalada.
- Ayudas en los botones, mejoras en importación, tablas y revisión de registros.
- Apertura con lectura agrupada de datos y carga de Declaración, Herramientas y Estadísticas cuando se seleccionan.

## Uso y privacidad

Fija el icono de ChatLog en la barra de extensiones y pulsa para abrir el panel lateral. La Guía de inicio explica la ruta proyecto → registro → declaración.

Los datos permanecen en el perfil local de Chrome. No se envían a servidores de ChatLog y no se capturan conversaciones automáticamente. Exporta periódicamente un respaldo JSON; el CSV permite analizar registros en una hoja de cálculo.

- [Manual de usuario en PDF](manuals/Manual_Usuario_ChatLog_v2.0.1.pdf)
- [Política de privacidad](https://tmarquez-mx.github.io/ChatLog/privacidad/)
- [Google Analytics e informes de distribución](ANALITICAS.md)
- [Sitio del proyecto](https://chatlog-ext.netlify.app)
- [Soporte](https://github.com/tmarquez-mx/ChatLog/issues)

## Instalación de desarrollo y comprobación

Descarga o clona el repositorio. En `chrome://extensions`, activa **Modo desarrollador**, pulsa **Cargar descomprimida** y selecciona la carpeta que contiene `manifest.json`. Requiere Chrome 116 o posterior. La copia de desarrollo tiene datos independientes de la extensión de la tienda: conserva antes un respaldo JSON.

```sh
npm test
python3 tools/package_extension.py --check
python3 tools/package_extension.py
```

Las 48 pruebas verifican guardado, recuperación, errores, compatibilidad, evidencia y módulos. El empaquetador incluye únicamente los 20 archivos de la extensión, con manual y política; genera el ZIP y la carpeta descomprimida en `dist/`.

Para la vista local, ejecuta `python3 tools/preview.py` y abre `http://127.0.0.1:8765/panel/index.html`. Conserva datos de prueba independientes. Teresa confirmó las pruebas desde el icono de Chrome y con un respaldo anterior antes de preparar esta actualización para la tienda.

## Organización del repositorio

`panel/`, `script.js`, `background.js` y `modules/` contienen la extensión. `icons/` conserva sus iconos; `manuals/` contiene un único manual PDF. La política está en `docs/privacidad/` para consulta sin conexión desde la extensión y en `privacidad/` para GitHub Pages. `tests/` y `tools/` permiten verificar y empaquetar el código. `website/` conserva los archivos necesarios del sitio publicado en Netlify, según `netlify.toml`.

Se retiraron demos antiguas, manuales duplicados, capturas anteriores y archivos de trabajo. Son recuperables en el historial de Git; las copias locales de trabajo se conservan.

## Autoría y licencias

Proyecto académico de acceso abierto del Departamento de Ciencias Sociales y Políticas de la Universidad Iberoamericana Ciudad de México, financiado por la Dirección de Innovación Educativa. Responsable: **Dra. Teresa Márquez**, teresa.marquez@ibero.mx.

Código: Apache-2.0. Materiales: CC BY 4.0. Consulta [licenciamiento](LICENSING.md) y [metadatos de cita](CITATION.cff). El [registro histórico en Zenodo](https://doi.org/10.5281/zenodo.21168851) corresponde a la versión 2.0 de junio de 2026.
