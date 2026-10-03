"""Actualiza el manual existente conservando sus estilos y componentes."""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'manuals/Manual_Usuario_ChatLog_v2.0.0.docx'
DEST = ROOT / 'manuals/Manual_Usuario_ChatLog_v2.0.1.docx'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}

REPLACEMENTS = {
    'En la pestaña Proyectos, escribe un nombre claro en el campo de nuevo proyecto.':
        'En Proyectos, pulsa Crear proyecto si el campo de nombre está oculto. Escribe el nombre del nuevo proyecto; al elegir uno existente, este campo se oculta.',
    'Escribe la empresa proveedora, el nombre del modelo y, si aplica, la version.':
        'En Empresa proveedora y Nombre del LLM puedes elegir una sugerencia o escribir otro nombre. Registra por separado la versión del modelo utilizado cuando sea visible.',
    'Version 2.0.0 | Guia para profesores universitarios y estudiantes':
        'Versión 2.0.1 | Guía para profesores universitarios y estudiantes',
    'Este manual esta pensado para personas no tecnicas. Por eso presenta instrucciones paso a paso, capturas comentadas, ejemplos concretos de uso universitario y recomendaciones practicas para evitar errores comunes.':
        'Este manual presenta instrucciones paso a paso, capturas comentadas y ejemplos de uso universitario. En la versión 2.0.1, los registros se guardan automáticamente, incluso incompletos. Las capturas de inicio, borrador y Sobre corresponden a 2.0.1; las restantes conservan las funciones de la interfaz 2.0.0.',
    '2. Registra cada interaccion importante con la herramienta de IA.':
        '2. Escribe cada interacción y espera el indicador de guardado automático.',
    'Guarda el registro.':
        'No necesitas pulsar Guardar registro. Espera «Guardado» o «Borrador guardado · faltan campos». «Nuevo registro» conserva la interacción actual y abre un formulario vacío. Al volver a abrir el panel, se recupera el formulario activo, aunque esté incompleto. En Herramientas puedes consultar los campos pendientes. Si aparece un error, conserva el formulario y pulsa «Reintentar guardado».',
    '4.2 Pestaña Proyectos': '4.2 Proyectos y guardado automático',
    'Pestaña principal para organizar el trabajo por proyectos.':
        'El formulario pertenece a la pestaña Proyectos.',
    'Ruta de trabajo resumida para comenzar sin perderse.':
        'El indicador confirma que el borrador está guardado y señala los campos pendientes.',
    'Acceso directo a la gestión de proyectos.':
        'Los datos incompletos se conservan y pueden completarse después.',
    'Botón para ir a la generación de declaraciones.':
        'Nuevo registro conserva esta captura; Pasar a declaración requiere completar los campos obligatorios.',
    'Botón para avanzar por los pasos de la guía.':
        'Comenzar cierra la guía y lleva a la gestión de proyectos.',
    'Confirma que existan registros guardados y seleccionados para la declaracion.':
        'Confirma que existan registros guardados y seleccionados. Completa los campos pendientes de los borradores antes de preparar la declaración.',
    'Responsable academica indicada en la extension: Dra. Teresa Marquez.':
        'Responsable académica: Dra. Teresa Márquez. Contacto: teresa.marquez@ibero.mx. Consulta la política de privacidad desde el panel Sobre; también explica el guardado de borradores y los permisos del navegador.',
    'Las estadisticas reemplazan la revision cualitativa?':
        '¿Las estadísticas reemplazan la revisión cualitativa?',
    'No. Son una ayuda para observar patrones, no un sustituto de la interpretacion academica.':
        'No. Son una ayuda para observar patrones en tus registros locales. No se envían a Google Analytics ni se comparten con la responsable. Los reportes de distribución se consultan por separado en Chrome Web Store.',
}

with ZipFile(SOURCE) as source, ZipFile(DEST, 'w') as target:
    numbering = etree.fromstring(source.read('word/numbering.xml'))
    styles = etree.fromstring(source.read('word/styles.xml'))
    default_id = styles.xpath('//w:style[@w:styleId="ListNumber"]//w:numId/@w:val', namespaces=NS)[0]
    abstract_id = numbering.xpath(f'//w:num[@w:numId="{default_id}"]/w:abstractNumId/@w:val', namespaces=NS)[0]
    next_id = max(int(n) for n in numbering.xpath('//w:num/@w:numId', namespaces=NS)) + 1
    document = etree.fromstring(source.read('word/document.xml'))
    in_captions = False
    current_list = None
    for para in document.xpath('/w:document/w:body/w:p', namespaces=NS):
        text = ''.join(para.xpath('.//w:t/text()', namespaces=NS))
        style = para.find('w:pPr/w:pStyle', NS)
        style_id = style.get('{'+NS['w']+'}val') if style is not None else ''
        if style_id.startswith('Heading'):
            in_captions = text.startswith('4.') and not text.startswith('4. Descripcion')
        if style_id == 'ListNumber':
            if in_captions:
                style.set('{'+NS['w']+'}val', 'ListBullet')
                current_list = None
            else:
                if current_list is None:
                    current_list = str(next_id)
                    next_id += 1
                    num = etree.SubElement(numbering, '{'+NS['w']+'}num', {'{'+NS['w']+'}numId':current_list})
                    etree.SubElement(num, '{'+NS['w']+'}abstractNumId', {'{'+NS['w']+'}val':abstract_id})
                    override = etree.SubElement(num, '{'+NS['w']+'}lvlOverride', {'{'+NS['w']+'}ilvl':'0'})
                    etree.SubElement(override, '{'+NS['w']+'}startOverride', {'{'+NS['w']+'}val':'1'})
                pr = para.find('w:pPr', NS)
                old = pr.find('w:numPr', NS)
                if old is not None: pr.remove(old)
                numpr = etree.SubElement(pr, '{'+NS['w']+'}numPr')
                etree.SubElement(numpr, '{'+NS['w']+'}ilvl', {'{'+NS['w']+'}val':'0'})
                etree.SubElement(numpr, '{'+NS['w']+'}numId', {'{'+NS['w']+'}val':current_list})
        else:
            current_list = None
    for node in document.xpath('//w:t', namespaces=NS):
        value = node.text or ''
        for before, after in REPLACEMENTS.items(): value = value.replace(before, after)
        node.text = value
    body = document.find('w:body', NS)
    anchor = next(p for p in body.findall('w:p', NS)
                  if ''.join(p.xpath('.//w:t/text()', namespaces=NS)).startswith('6. Ejemplos'))
    desktop_guidance = [
        ('Heading2', '5.6 Registrar interacciones en aplicaciones de escritorio'),
        ('Normal', 'ChatLog puede documentar interacciones realizadas en aplicaciones de escritorio. Mantén ChatLog abierto en Chrome mientras trabajas en la otra aplicación. La captura es manual: la extensión no lee ni registra automáticamente su contenido.'),
        ('Normal', 'Copia el prompt relevante y registra la finalidad, la fecha, la empresa proveedora y el nombre y versión del modelo cuando sean visibles. No confundas la versión de la aplicación con la del modelo. En Observaciones indica la aplicación utilizada y dónde conservas la evidencia. Documenta también la verificación humana y las decisiones que tomaste.'),
        ('Normal', 'En Referencia de la interacción elige Enlace web a la conversación si tienes una URL de la conversación, o Archivo de evidencia conservada si guardaste una exportación, transcripción o capturas. En Nombre y ubicación del archivo puedes escribir una ruta en tu equipo, preferiblemente relativa al proyecto, o pegar la URL del archivo en Google Drive o OneDrive. ChatLog no adjunta ni abre el archivo ni comprueba sus permisos de acceso. No necesitas publicar conversaciones confidenciales para llenar este campo.'),
        ('Normal', 'Cualquiera de las dos opciones permite completar el registro cuando también llenas los demás campos obligatorios. Puedes desplegar Qué es la evidencia y cómo recogerla en el formulario. Al generar una declaración estándar o detallada, Incluir enlaces o referencias de evidencia incorpora la referencia seleccionada. APA y AID distinguen un enlace web de la evidencia conservada. Revisa siempre el texto y las indicaciones de tu institución o publicación antes de entregarlo.'),
        ('Normal', 'El aviso de las declaraciones estándar y detalladas identifica la versión de la extensión utilizada para generar el texto: Esta declaración fue generada automáticamente utilizando ChatLog, versión 2.0.1. Esta versión corresponde a ChatLog, no al LLM registrado.'),
        ('Heading2', '5.7 Qué es la evidencia y cómo recogerla'),
        ('Normal', 'La evidencia es una copia del intercambio con el LLM que permite revisar qué instrucciones diste, qué respondió el modelo y cómo utilizaste su respuesta. Puede ser una exportación de la conversación en PDF o texto, una transcripción o capturas de pantalla. Conservarla permite respaldar el registro de ChatLog; no demuestra por sí misma que la respuesta del modelo sea correcta.'),
        ('Normal', '1. Selecciona el intercambio que influyó en tu trabajo. Incluye tus instrucciones, las respuestas relevantes y los mensajes anteriores necesarios para entender el contexto. Si conservas solo un fragmento, identifícalo como extracto.'),
        ('Normal', '2. Guarda una copia. Si la aplicación permite exportar o imprimir la conversación, conserva el archivo en PDF o texto. Si no, copia el intercambio en un documento e identifica quién escribió cada mensaje. Otra opción es tomar capturas legibles y ordenadas que incluyan las instrucciones y las respuestas, sin cortar información necesaria para comprenderlas.'),
        ('Normal', '3. Añade los datos de contexto disponibles: fecha de la interacción, aplicación, empresa proveedora y nombre y versión del modelo cuando se muestren. Si un dato no aparece, indica que no está disponible; no lo deduzcas ni lo inventes. Describe en ChatLog cómo verificaste la respuesta y qué aceptaste, modificaste o descartaste.'),
        ('Normal', '4. Organiza los archivos en una carpeta de evidencias dentro de tu proyecto. Usa nombres que permitan identificarlos, por ejemplo 2026-10-01_revision-pregunta-investigacion.pdf. Anota la ubicación relativa a esa carpeta, para que la referencia siga siendo útil al trasladar el proyecto a otro equipo.'),
        ('Normal', '5. Selecciona Archivo de evidencia conservada. En Nombre y ubicación del archivo escribe una ruta como Evidencias/2026-10-01_revision-pregunta-investigacion.pdf, o pega la URL del archivo en Google Drive o OneDrive. En Observaciones indica qué mensajes contiene y si es un extracto. ChatLog guarda la referencia; no adjunta ni abre el archivo ni comprueba sus permisos. Si otra persona necesita revisarlo, comprueba que tenga acceso al archivo.'),
        ('Normal', '6. Conserva el archivo junto con un respaldo del proyecto. Para compartirlo, prepara una copia que oculte datos personales o confidenciales ajenos al propósito de la revisión e indica qué se omitió. La evidencia puede permanecer privada; no necesitas subirla a internet para documentar la interacción. El respaldo CSV o JSON de ChatLog no incluye estos archivos de evidencia.'),
        ('Heading2', '5.8 Ejemplo de un registro con evidencia de escritorio'),
        ('Normal', 'Este ejemplo ficticio muestra cómo completar el formulario. Sustituye los datos por los de tu interacción real y crea el archivo de evidencia antes de referenciarlo.'),
        ('Normal', 'Proyecto: Tesis sobre participación estudiantil. Nombre de la interacción: Revisión de la pregunta de investigación. Finalidad: Conceptualización y delimitación del tema (usa Otro si no aparece en la lista). Fecha de interacción: 1 de octubre de 2026.'),
        ('Normal', 'Empresa proveedora: Proveedor de ejemplo. Nombre del LLM: Modelo de ejemplo. Versión del LLM: no disponible en la aplicación. Referencia de la interacción: Archivo de evidencia conservada. Nombre y ubicación del archivo: Evidencias/2026-10-01_revision-pregunta-investigacion.pdf.'),
        ('Normal', 'Prompt: Señala ambigüedades en esta pregunta y propón dos formas de delimitarla: ¿Cómo participan los estudiantes en las decisiones de su universidad?'),
        ('Normal', 'Etapa del trabajo: Delimitación del problema. Verificación humana y responsabilidad: Contrasté las sugerencias con mis objetivos y bibliografía; descarté una propuesta que ampliaba demasiado el estudio. La pregunta final y la decisión de delimitarla corresponden a la persona autora.'),
        ('Normal', 'Observaciones: Interacción realizada en una aplicación de escritorio de ejemplo. El PDF conserva el prompt y la respuesta completa de esta consulta; no incluye otras conversaciones. Etiquetas: tesis, pregunta de investigación. Calificación de utilidad: 4 de 5.'),
        ('Normal', 'Espera el indicador Guardado. En la declaración estándar aparecerá Evidencia conservada: Evidencias/2026-10-01_revision-pregunta-investigacion.pdf. La referencia describe dónde guardaste el archivo; no funciona como enlace público ni garantiza que otras personas tengan acceso.'),
        ('Heading2', '5.9 Elegir entre JSON y CSV'),
        ('Normal', 'Al pasar el mouse por un botón o llegar a él con el teclado, ChatLog muestra una explicación de su función. JSON es el formato recomendado para respaldar y restaurar proyectos y registros en ChatLog, por ejemplo al cambiar de equipo. CSV es una tabla para revisar y analizar los registros en Excel o Google Sheets; también puede importarse, pero JSON conserva mejor la estructura para restaurarla.'),
        ('Normal', 'La exportación respeta el alcance seleccionado. Ambos formatos conservan las rutas y URLs de evidencia, pero no incluyen los archivos. Respalda también los archivos de evidencia, tanto si están en tu equipo como en Google Drive o OneDrive.'),
    ]
    for style_id, text in desktop_guidance:
        para = etree.Element('{'+NS['w']+'}p')
        pr = etree.SubElement(para, '{'+NS['w']+'}pPr')
        etree.SubElement(pr, '{'+NS['w']+'}pStyle', {'{'+NS['w']+'}val':style_id})
        run = etree.SubElement(para, '{'+NS['w']+'}r')
        etree.SubElement(run, '{'+NS['w']+'}t').text = text
        body.insert(body.index(anchor), para)
    for member in source.infolist():
        content = source.read(member.filename)
        if member.filename == 'word/document.xml':
            content = etree.tostring(document, xml_declaration=True, encoding='UTF-8', standalone=True)
        elif member.filename == 'word/numbering.xml':
            content = etree.tostring(numbering, xml_declaration=True, encoding='UTF-8', standalone=True)
        elif member.filename == 'word/media/image1.png':
            content = (ROOT / 'manual_assets/chatlog_manual/inicio_2.0.1.png').read_bytes()
        elif member.filename == 'word/media/image2.png':
            content = (ROOT / 'manual_assets/chatlog_manual/borrador_2.0.1.png').read_bytes()
        elif member.filename == 'word/media/image8.png':
            content = (ROOT / 'manual_assets/chatlog_manual/sobre_2.0.1.png').read_bytes()
        target.writestr(member, content)

print(DEST)
