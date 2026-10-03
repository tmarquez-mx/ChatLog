import { loadFromStorage } from './storage.js';

import { appState, ui } from './runtime.js';

import { buildDuplicateRecordMap, getChatLogVersion, getEvidenceLabel, getEvidenceType, getEvidenceValue, isValidInteractionLink } from './records.js';

function setupDeclarationTab() {
    document.getElementById('declaration-project-select').addEventListener('change', filterRecordsForDeclaration);
    document.getElementById('select-all-records-btn').addEventListener('click', selectAllRecords);
    document.getElementById('deselect-all-records-btn').addEventListener('click', deselectAllRecords);
    document.getElementById('generate-declaration-btn').addEventListener('click', generateDeclaration);
    document.getElementById('copy-declaration-btn').addEventListener('click', copyDeclarationToClipboard);
    document.getElementById('download-declaration-btn').addEventListener('click', downloadDeclaration);
    document.getElementById('declaration-work-type').addEventListener('change', applyRecommendedDeclarationFormat);
    document.getElementById('declaration-format').addEventListener('change', updateDeclarationFormatGuidance);
    updateDeclarationFormatGuidance();
}

async function loadDeclarationProjects() {
    const projects = await loadFromStorage('chatlog_projects') || [];
    const declarationProjectSelect = document.getElementById('declaration-project-select');

    const defaultOptions = Array.from(declarationProjectSelect.options).slice(0, 2);
    declarationProjectSelect.innerHTML = '';
    defaultOptions.forEach(option => declarationProjectSelect.appendChild(option));

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        declarationProjectSelect.appendChild(option);
    });
}

async function loadRecordsForDeclaration() {
    const records = await loadFromStorage('chatlog_records') || [];
    const noRecordsMessage = document.getElementById('no-declaration-records-message');
    const recordsList = document.getElementById('records-list');

    if (records.length === 0) {
        appState.selectedRecords = [];
        noRecordsMessage.style.display = 'block';
        recordsList.innerHTML = '';
        return;
    }

    noRecordsMessage.style.display = 'none';
    appState.selectedRecords = ui.retainValidRecordSelection(appState.selectedRecords, records);
    await filterRecordsForDeclaration();
}

async function filterRecordsForDeclaration() {
    const projectFilter = document.getElementById('declaration-project-select').value;
    let records = [...(await loadFromStorage('chatlog_records') || [])];

    if (projectFilter !== 'all') {
        if (projectFilter === 'none') {
            records = records.filter(record => !record.projectId);
        } else {
            records = records.filter(record => record.projectId === projectFilter);
        }
    }

    records.sort((a, b) => {
        const projectA = a.projectId || 'zzz';
        const projectB = b.projectId || 'zzz';
        if (projectA !== projectB) return projectA.localeCompare(projectB);
        return new Date(b.dateModified) - new Date(a.dateModified);
    });

    const recordsList = document.getElementById('records-list');
    const noRecordsMessage = document.getElementById('no-declaration-records-message');

    if (records.length === 0) {
        noRecordsMessage.style.display = 'block';
        recordsList.innerHTML = '';
        return;
    }

    noRecordsMessage.style.display = 'none';
    recordsList.innerHTML = '';

    const projects = await loadFromStorage('chatlog_projects') || [];
    const projectsMap = Object.create(null);
    projects.forEach(project => { projectsMap[project.id] = project.name; });
    const selectedIds = new Set(appState.selectedRecords);
    const fragment = document.createDocumentFragment();

    records.forEach(record => {
        const recordItem = document.createElement('div');
        recordItem.className = 'record-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'record-checkbox';
        checkbox.value = record.id;
        checkbox.checked = selectedIds.has(record.id);
        checkbox.addEventListener('change', function() {
            if (this.checked) {
                if (!appState.selectedRecords.includes(record.id)) appState.selectedRecords.push(record.id);
            } else {
                const index = appState.selectedRecords.indexOf(record.id);
                if (index !== -1) appState.selectedRecords.splice(index, 1);
            }
        });

        const recordInfo = document.createElement('div');
        recordInfo.className = 'record-info';

        const recordTitle = document.createElement('div');
        recordTitle.className = 'record-title';

        if (record.rating && parseInt(record.rating) > 0) {
            const titleText = document.createElement('span');
            titleText.textContent = record.interactionName;
            const ratingSpan = document.createElement('span');
            ratingSpan.innerHTML = '&nbsp;' + '★'.repeat(parseInt(record.rating));
            ratingSpan.style.color = 'var(--star-active)';
            ratingSpan.style.fontSize = '0.9em';
            recordTitle.appendChild(titleText);
            recordTitle.appendChild(ratingSpan);
        } else {
            recordTitle.textContent = record.interactionName;
        }

        const recordDetails = document.createElement('div');
        recordDetails.className = 'record-details';
        const formattedDate = new Date(record.dateModified).toLocaleDateString(undefined, {
            year: 'numeric', month: 'short', day: 'numeric'
        });
        const projectName = (record.projectId && projectsMap[record.projectId])
            ? projectsMap[record.projectId]
            : 'Sin proyecto';
        recordDetails.textContent = `${record.llmName} (${record.purpose}) - ${formattedDate} - ${projectName}`;

        recordInfo.appendChild(recordTitle);
        recordInfo.appendChild(recordDetails);
        recordItem.appendChild(checkbox);
        recordItem.appendChild(recordInfo);
        fragment.appendChild(recordItem);
    });
    recordsList.appendChild(fragment);
}

function selectAllRecords() {
    const selectedIds = new Set(appState.selectedRecords);
    document.querySelectorAll('.record-checkbox').forEach(checkbox => {
        checkbox.checked = true;
        selectedIds.add(checkbox.value);
    });
    appState.selectedRecords = Array.from(selectedIds);
}

function deselectAllRecords() {
    document.querySelectorAll('.record-checkbox').forEach(checkbox => { checkbox.checked = false; });
    appState.selectedRecords = [];
}

function applyRecommendedDeclarationFormat() {
    const workType = document.getElementById('declaration-work-type').value;
    const recommendation = document.getElementById('declaration-format-recommendation');
    if (!workType) {
        recommendation.textContent = 'Puedes elegir directamente un formato o indicar el tipo de trabajo.';
        return;
    }

    const formatSelect = document.getElementById('declaration-format');
    const formatNames = {
        apa: 'Estilo APA',
        elsevier: 'Estilo Elsevier',
        aid: 'Estilo AID Framework',
        detailed: 'Detallado',
        minimal: 'Mínimo'
    };
    formatSelect.value = workType;
    recommendation.textContent = `Formato recomendado y seleccionado: ${formatNames[workType]}.`;
    updateDeclarationFormatGuidance();
}

function updateDeclarationFormatGuidance() {
    const format = document.getElementById('declaration-format').value;
    const guidanceByFormat = {
        standard: 'Resumen general organizado por proyecto, con los datos seleccionados para cada interacción.',
        detailed: 'Formato ampliado con trazabilidad de modelos, finalidades, etiquetas, prompts y notas.',
        minimal: 'Constancia breve del número de interacciones, modelos y finalidades.',
        apa: 'Incluye autoría, institución, modelo, proveedor, fecha, finalidad, etapa, prompt y enlace o referencia de evidencia.',
        elsevier: 'Declaración editorial breve sobre la herramienta, su finalidad y la responsabilidad de autoría.',
        aid: 'Incluye herramienta, fecha, propósito, prompt, contribución humana, verificación y registro de interacción.'
    };

    document.getElementById('declaration-format-guidance').textContent = guidanceByFormat[format] || '';
}

function quotePrompt(promptText) {
    const trimmedPrompt = String(promptText || '').trim();
    const unwrappedPrompt = trimmedPrompt.replace(/^["“”]+|["“”]+$/g, '').trim();
    return `“${unwrappedPrompt}”`;
}

function formatInteractionDate(interactionDate, options) {
    if (!interactionDate) return 'Sin especificar';

    const parsedDate = new Date(`${interactionDate}T00:00:00`);
    if (Number.isNaN(parsedDate.getTime())) return interactionDate;

    return parsedDate.toLocaleDateString(undefined, options);
}

function isMissingRecordValue(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return !normalized || ['sin nombre', 'sin especificar', 'importado desde csv'].includes(normalized);
}

function validateDeclarationRecords(records, format, options) {
    const issues = new Set();
    const duplicateRecords = buildDuplicateRecordMap(records);
    const addIssue = (record, label) => {
        issues.add(`- ${record.interactionName || 'Registro sin nombre'}: falta ${label}.`);
    };

    if (format === 'apa') {
        if (!options.researcherName) issues.add('- Datos de autoría: falta el nombre del investigador o estudiante.');
        if (!options.institutionName) issues.add('- Datos de autoría: falta la institución.');
    }

    records.forEach(record => {
        if (isMissingRecordValue(record.interactionName)) addIssue(record, 'nombre de la interacción');
        if (isMissingRecordValue(record.purpose)) addIssue(record, 'finalidad');
        if (isMissingRecordValue(record.llmName)) addIssue(record, 'nombre del LLM');

        if (
            (format === 'apa' || format === 'aid' || options.includePrompts) &&
            isMissingRecordValue(record.prompt)
        ) {
            addIssue(record, 'prompt');
        }
        if (
            (format === 'apa' || format === 'aid' || options.includeLinks) &&
            isMissingRecordValue(getEvidenceValue(record))
        ) {
            addIssue(record, getEvidenceType(record) === 'local' ? 'referencia de evidencia' : 'liga de interacción');
        } else if (
            (format === 'apa' || format === 'aid' || options.includeLinks) &&
            getEvidenceType(record) === 'url' && !isValidInteractionLink(record.interactionLink)
        ) {
            issues.add(`- ${record.interactionName || 'Registro sin nombre'}: la liga de interacción no es válida.`);
        }
        if (
            (format === 'apa' || format === 'aid' || appState.qualityRules.requireDate) &&
            isMissingRecordValue(record.interactionDate)
        ) {
            addIssue(record, 'fecha de interacción');
        }
        if (
            (format === 'apa' || appState.qualityRules.requireProvider) &&
            isMissingRecordValue(record.providerCompany)
        ) {
            addIssue(record, 'empresa proveedora');
        }
        if (
            (format === 'apa' || appState.qualityRules.requireStage) &&
            isMissingRecordValue(record.ethicalNotes)
        ) {
            addIssue(record, 'etapa del trabajo');
        }
        if (appState.qualityRules.requireVerification && isMissingRecordValue(record.biasNotes)) {
            addIssue(record, 'verificación humana y responsabilidad');
        }
        if (appState.qualityRules.requireProject && !record.projectId) {
            issues.add(`- ${record.interactionName || 'Registro sin nombre'}: no está asignado a un proyecto.`);
        }
        if (duplicateRecords.has(record.id)) {
            issues.add(`- ${record.interactionName || 'Registro sin nombre'}: posible registro duplicado.`);
        }
    });

    return Array.from(issues);
}

async function generateDeclaration() {
    if (appState.selectedRecords.length === 0) {
        ui.showAppStatus('Selecciona al menos un registro para incluir en la declaración.', 'error');
        return;
    }

    const format = document.getElementById('declaration-format').value;
    const researcherName = document.getElementById('researcher-name').value.trim();
    const institutionName = document.getElementById('institution-name').value.trim();
    const includePrompts = document.getElementById('include-prompts').checked;
    const includeLinks = document.getElementById('include-links').checked;
    const includeDates = document.getElementById('include-dates').checked;

    const allRecords = await loadFromStorage('chatlog_records') || [];
    const projects = await loadFromStorage('chatlog_projects') || [];
    const projectsMap = Object.create(null);
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    const selectedIds = new Set(appState.selectedRecords);
    const recordsToInclude = allRecords
        .filter(record => selectedIds.has(record.id))
        .sort((a, b) => {
            const pA = a.projectId || 'zzz';
            const pB = b.projectId || 'zzz';
            if (pA !== pB) return pA.localeCompare(pB);
            return new Date(a.dateModified) - new Date(b.dateModified);
        });

    await ui.loadQualityReviewSettings();
    const validationIssues = validateDeclarationRecords(recordsToInclude, format, {
        researcherName,
        institutionName,
        includePrompts,
        includeLinks
    });
    if (validationIssues.length > 0) {
        const visibleIssues = validationIssues.slice(0, 12);
        const remainingIssues = validationIssues.length - visibleIssues.length;
        const remainingText = remainingIssues > 0
            ? `\n... y ${remainingIssues} observaciones adicionales.`
            : '';
        const shouldContinue = await ui.appConfirm(
            `Revisa estas recomendaciones antes de generar la declaración:\n\n${visibleIssues.join('\n')}${remainingText}\n\n¿Deseas generar la declaración de todos modos?`,
            { title: 'Revisión de la declaración', confirmLabel: 'Generar de todos modos' }
        );
        if (!shouldContinue) return;
    }

    let declarationText = '';

    switch (format) {
        case 'standard':
            declarationText += '== DECLARACIÓN DE USO DE MODELOS DE LENGUAJE ==\n\n';
            if (researcherName) declarationText += `Investigador/a: ${researcherName}\n`;
            if (institutionName) declarationText += `Institución: ${institutionName}\n`;
            declarationText += `Fecha de la declaración: ${new Date().toLocaleDateString()}\n\n`;
            declarationText += `Esta declaración detalla el uso de modelos de lenguaje (LLMs) en el proceso de investigación. Se incluyen ${recordsToInclude.length} interacciones con LLMs.\n\n`;
            break;

        case 'detailed':
            declarationText += '===============================================================\n';
            declarationText += '      DECLARACIÓN DETALLADA DE USO DE MODELOS DE LENGUAJE      \n';
            declarationText += '===============================================================\n\n';
            if (researcherName || institutionName) {
                declarationText += 'INFORMACIÓN DEL INVESTIGADOR\n-----------------------------\n';
                if (researcherName) declarationText += `Nombre: ${researcherName}\n`;
                if (institutionName) declarationText += `Institución: ${institutionName}\n`;
                declarationText += '\n';
            }
            declarationText += 'RESUMEN DE INTERACCIONES\n------------------------\n';
            declarationText += `Total de interacciones documentadas: ${recordsToInclude.length}\n`;
            const uniqueModels = new Set(recordsToInclude.map(r => r.llmName + (r.llmVersion ? ` ${r.llmVersion}` : '')));
            declarationText += `Modelos utilizados: ${uniqueModels.size}\n`;
            declarationText += 'Modelos: ' + Array.from(uniqueModels).join(', ') + '\n\n';
            const uniquePurposes = new Set(recordsToInclude.map(r => r.purpose));
            declarationText += `Finalidades: ${Array.from(uniquePurposes).join(', ')}\n\n`;
            declarationText += `Fecha de la declaración: ${new Date().toLocaleDateString()}\n\n`;
            declarationText += '===============================================================\n\n';
            break;

        case 'minimal':
            declarationText += 'DECLARACIÓN DE USO DE LLMs\n\n';
            if (researcherName) declarationText += `Por: ${researcherName}\n`;
            if (institutionName) declarationText += `${institutionName}\n`;
            declarationText += `${new Date().toLocaleDateString()}\n\n`;
            declarationText += `Se utilizaron modelos de lenguaje en ${recordsToInclude.length} ocasiones durante el proceso de investigación.\n\n`;
            break;

        case 'apa':
            if (recordsToInclude.length > 1) {
                const apaResearcher = researcherName || '[Nombre del investigador/estudiante]';
                const apaInstitution = institutionName || '[Institución]';
                declarationText += `Yo ${apaResearcher} estudiante o académicX de la ${apaInstitution} declaro que utilicé las siguientes herramientas de inteligencia artificial:\n\n`;
            }
            break;

        case 'elsevier':
            if (recordsToInclude.length > 1) {
                declarationText += 'En la preparación de este trabajo, el autor/autora usó las siguientes herramientas de inteligencia artificial:\n\n';
            }
            break;

        case 'aid':
            declarationText += 'Declaración de uso de inteligencia artificial (AID Framework)\n\n';
            break;
    }

    let currentProject = null;

    recordsToInclude.forEach((record, index) => {
        if ((format === 'detailed' || format === 'standard') && record.projectId !== currentProject) {
            currentProject = record.projectId;
            if (index > 0) declarationText += '\n';
            declarationText += '---\n\n';
            declarationText += `PROYECTO: ${record.projectId ? projectsMap[record.projectId] : 'Sin proyecto asignado'}\n\n`;
        }

        switch (format) {
            case 'standard':
                declarationText += `${index + 1}. ${record.interactionName}`;
                if (record.rating && parseInt(record.rating) > 0) declarationText += ` (Calificación: ${record.rating}/5)`;
                declarationText += '\n';
                declarationText += `   Modelo: ${record.llmName}${record.llmVersion ? ` (${record.llmVersion})` : ''}\n`;
                declarationText += `   Finalidad: ${record.purpose}\n`;
                if (includeDates) declarationText += `   Fecha: ${formatInteractionDate(record.interactionDate)}\n`;
                if (includePrompts) declarationText += `   Prompt: ${quotePrompt(record.prompt)}\n`;
                if (includeLinks && getEvidenceValue(record)) declarationText += `   ${getEvidenceLabel(record)}: ${getEvidenceValue(record)}\n`;
                if (record.ethicalNotes) declarationText += `   Etapa del trabajo: ${record.ethicalNotes}\n`;
                if (record.biasNotes) declarationText += `   Verificación humana y responsabilidad: ${record.biasNotes}\n`;
                declarationText += '\n';
                break;

            case 'detailed':
                declarationText += `INTERACCIÓN #${index + 1}: ${record.interactionName}`;
                if (record.rating && parseInt(record.rating) > 0) declarationText += ` (Calificación: ${record.rating}/5)`;
                declarationText += '\n';
                declarationText += `------------------------${'-'.repeat(record.interactionName.length)}\n`;
                declarationText += `Modelo: ${record.llmName}${record.llmVersion ? ` (${record.llmVersion})` : ''}\n`;
                declarationText += `Finalidad: ${record.purpose}\n`;
                if (includeDates) {
                    declarationText += `Fecha: ${formatInteractionDate(record.interactionDate, {
                        year: 'numeric', month: 'long', day: 'numeric'
                    })}\n`;
                }
                if (record.tags && record.tags.length > 0) declarationText += `Etiquetas: ${record.tags.join(', ')}\n`;
                if (includeLinks && getEvidenceValue(record)) declarationText += `${getEvidenceLabel(record)}: ${getEvidenceValue(record)}\n`;
                if (includePrompts) {
                    declarationText += '\nPROMPT UTILIZADO:\n----------------\n';
                    declarationText += `${quotePrompt(record.prompt)}\n`;
                }
                if (record.ethicalNotes || record.biasNotes || record.observations) {
                    declarationText += '\nNOTAS ADICIONALES:\n-----------------\n';
                    if (record.ethicalNotes) declarationText += `Etapa del trabajo: ${record.ethicalNotes}\n`;
                    if (record.biasNotes) declarationText += `Verificación humana y responsabilidad: ${record.biasNotes}\n`;
                    if (record.observations) declarationText += `Observaciones: ${record.observations}\n`;
                }
                declarationText += '\n';
                break;

            case 'minimal':
                declarationText += `- ${record.interactionName}: ${record.llmName}${record.llmVersion ? ` (${record.llmVersion})` : ''} - ${record.purpose}`;
                if (record.rating && parseInt(record.rating) > 0) declarationText += ` (${record.rating}/5)`;
                declarationText += '\n';
                break;

            case 'apa': {
                const apaResearcher = researcherName || '[Nombre del investigador/estudiante]';
                const apaInstitution = institutionName || '[Institución]';
                const apaModel = `${record.llmName || '[Nombre del LLM]'}${record.llmVersion ? ` ${record.llmVersion}` : ''}`;
                const apaProvider = record.providerCompany || '[Empresa proveedora]';
                const apaPurpose = record.purpose || '[finalidad de la interacción]';
                const apaStage = record.ethicalNotes || '[etapa del trabajo]';
                const apaPrompt = record.prompt || '[prompt]';
                const apaLink = getEvidenceValue(record) || '[referencia de la interacción]';
                const apaQuotedPrompt = quotePrompt(apaPrompt);
                const apaPromptSeparator = /[.!?]$/.test(apaPrompt.trim()) ? ' ' : '. ';
                let apaDate = '[fecha de interacción]';

                if (record.interactionDate) {
                    const parsedDate = new Date(`${record.interactionDate}T00:00:00`);
                    if (!Number.isNaN(parsedDate.getTime())) {
                        apaDate = parsedDate.toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                    }
                }

                if (recordsToInclude.length > 1) {
                    declarationText += `${index + 1}. ${apaModel} de ${apaProvider} (${apaDate}). Finalidad de la interacción: ${apaPurpose}. Uso en el trabajo: generar ideas o borradores de ${apaStage}. Prompt utilizado: ${apaQuotedPrompt}${apaPromptSeparator}${getEvidenceLabel(record)}: ${apaLink}.`;
                } else {
                    declarationText += `Yo ${apaResearcher} estudiante o académicX de la ${apaInstitution} declaro que utilicé ${apaModel} de ${apaProvider} (${apaDate}) para ${apaPurpose} y generar ideas o borradores de ${apaStage}. El prompt utilizado fue ${apaQuotedPrompt}${apaPromptSeparator}${getEvidenceLabel(record)}: ${apaLink}.`;
                }
                declarationText += '\n\n';
                break;
            }

            case 'elsevier': {
                const elsevierModel = `${record.llmName || '[Nombre del LLM]'}${record.llmVersion ? ` ${record.llmVersion}` : ''}`;
                const elsevierPurpose = record.purpose || '[finalidad de la interacción]';

                if (recordsToInclude.length > 1) {
                    declarationText += `${index + 1}. ${elsevierModel} para ${elsevierPurpose}.`;
                } else {
                    declarationText += `En la preparación de este trabajo, el autor/autora usó ${elsevierModel} para ${elsevierPurpose}.`;
                }
                declarationText += '\n\n';
                break;
            }

            case 'aid': {
                const aidModel = `${record.llmName || '[Nombre del LLM]'}${record.llmVersion ? ` ${record.llmVersion}` : ''}`;
                const aidPurpose = record.purpose || '[propósito del uso]';
                const aidPrompt = record.prompt || '[Prompt]';
                const aidLink = `${getEvidenceLabel(record)}: ${getEvidenceValue(record) || '[referencia de la interacción]'}`;
                const aidPromptText = aidPrompt.trim();
                const aidPromptStatement = /[.!?]$/.test(aidPromptText)
                    ? quotePrompt(aidPromptText)
                    : `${quotePrompt(aidPromptText)}.`;
                let aidDate = '[Fecha de la interacción]';

                if (record.interactionDate) {
                    const parsedDate = new Date(`${record.interactionDate}T00:00:00`);
                    if (!Number.isNaN(parsedDate.getTime())) {
                        aidDate = parsedDate.toLocaleDateString('es-MX', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                        });
                    }
                }

                if (recordsToInclude.length > 1) {
                    declarationText += `${index + 1}.\n`;
                }
                declarationText += `Herramienta(s) utilizada y fecha(s): ${aidModel}. ${aidDate}\n`;
                declarationText += `Propósito del uso: ${aidPurpose}. (p.e. Apoyo en la conceptualización del estudio y revisión preliminar de la pregunta de investigación).\n\n`;
                declarationText += `Interacción realizada: ${aidPromptStatement}\n\n`;
                declarationText += 'Contribución humana: (p.e. La formulación original de la pregunta de investigación, la selección del problema de estudio, la interpretación de las sugerencias y la decisión final sobre la redacción correspondieron íntegramente a la persona autora).\n\n';
                declarationText += 'Verificación y revisión: Todas las recomendaciones generadas fueron evaluadas críticamente y contrastadas con la literatura especializada y los objetivos del proyecto antes de su incorporación.\n\n';
                declarationText += `Registro de interacción: ${aidLink}\n\n`;
                break;
            }
        }
    });

    if (format === 'standard' || format === 'detailed') {
        declarationText += '\n===========\n';
        declarationText += `Esta declaración fue generada automáticamente utilizando ChatLog, versión ${getChatLogVersion()}.\n`;
    } else if (format === 'apa') {
        declarationText += 'Asumo toda la responsabilidad por el contenido de este proyecto/trabajo/ensayo de investigación.\n\n';
        declarationText += '*Nota: APA recomienda ubicar la declaración de uso en la sección de Métodos o metodología, o en una sección comparable del artículo. Para revisiones de literatura u otros tipos de ensayos, puede describirse su uso en la introducción.\n';
    } else if (format === 'elsevier') {
        declarationText += 'Después de usar esta herramienta, el autor/autora revisó y editó el contenido según fuera necesario y toma total responsabilidad del contenido del artículo publicado.\n\n';
        declarationText += '*Nota: Elsevier solicita que el texto sea colocado en una sección nueva titulada “Declaración de IA generativa y tecnológicas asistidas por IA en el proceso de escritura”, al final del manuscrito y justo antes de las referencias bibliográficas.\n';
    }

    renderDeclarationPreview(declarationText, format);
}

function renderDeclarationPreview(declarationText, format) {
    const preview = document.getElementById('declaration-preview');

    if (format !== 'aid') {
        preview.textContent = declarationText;
        return;
    }

    const graySegments = [
        '(p.e. Apoyo en la conceptualización del estudio y revisión preliminar de la pregunta de investigación).',
        '(p.e. La formulación original de la pregunta de investigación, la selección del problema de estudio, la interpretación de las sugerencias y la decisión final sobre la redacción correspondieron íntegramente a la persona autora).'
    ];
    const fragment = document.createDocumentFragment();
    let remainingText = declarationText;

    while (remainingText) {
        let nextSegment = null;
        let nextIndex = -1;

        graySegments.forEach(segment => {
            const segmentIndex = remainingText.indexOf(segment);
            if (segmentIndex !== -1 && (nextIndex === -1 || segmentIndex < nextIndex)) {
                nextSegment = segment;
                nextIndex = segmentIndex;
            }
        });

        if (nextIndex === -1) {
            fragment.appendChild(document.createTextNode(remainingText));
            break;
        }

        fragment.appendChild(document.createTextNode(remainingText.slice(0, nextIndex)));
        const example = document.createElement('span');
        example.className = 'aid-example-text';
        example.textContent = nextSegment;
        fragment.appendChild(example);
        remainingText = remainingText.slice(nextIndex + nextSegment.length);
    }

    preview.replaceChildren(fragment);
}

function copyDeclarationToClipboard() {
    const declarationText = document.getElementById('declaration-preview').textContent;

    if (!declarationText || declarationText === 'La declaración se mostrará aquí después de generarla.') {
        ui.showAppStatus('No hay declaración para copiar. Genera una declaración primero.', 'error');
        return;
    }

    navigator.clipboard.writeText(declarationText)
        .then(() => ui.showAppStatus('Declaración copiada al portapapeles.'))
        .catch(err => {
            ui.showAppStatus('Error al copiar la declaración.', 'error');
            console.error('Error al copiar al portapapeles:', err);
        });
}

function downloadDeclaration() {
    const declarationText = document.getElementById('declaration-preview').textContent;

    if (!declarationText || declarationText === 'La declaración se mostrará aquí después de generarla.') {
        ui.showAppStatus('No hay declaración para descargar. Genera una declaración primero.', 'error');
        return;
    }

    const blob = new Blob([declarationText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const filename = `declaracion_llm_${new Date().toISOString().split('T')[0]}.txt`;

    chrome.downloads.download({ url, filename, saveAs: false }, () => {
        if (chrome.runtime.lastError) {
            console.error('Error al descargar declaración:', chrome.runtime.lastError);
            ui.showAppStatus('Error al descargar la declaración.', 'error');
        }
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
}

Object.assign(ui, { setupDeclarationTab, loadDeclarationProjects, loadRecordsForDeclaration });

export { setupDeclarationTab, loadDeclarationProjects, loadRecordsForDeclaration };
