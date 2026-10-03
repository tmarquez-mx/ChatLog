import { loadFromStorage, readCollectionForUpdate, saveStorageValues } from './storage.js';

import { escapeCsvValue, normalizeImportedEvidence, normalizeImportedJsonRecords, parseCSV, parseImportedBoolean, reconcileImportedProjects, sanitizeFilenamePart, validateImportedProjects, validateImportedRecords } from './import-data.js';

import { downloadExport, downloadJSON } from './downloads.js';

import { ACTIVE_RECORD_DRAFT_KEY, ui } from './runtime.js';

import { buildImportReport, generateUniqueId, getChatLogVersion, getEvidenceType } from './records.js';

function populateExportProjectFilter(projects) {
    const filter = document.getElementById('export-project-filter');
    if (!filter) return;

    const currentValue = filter.value || 'all';
    filter.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'Todos los proyectos y registros';
    filter.appendChild(allOption);

    const noneOption = document.createElement('option');
    noneOption.value = 'none';
    noneOption.textContent = 'Registros sin proyecto';
    filter.appendChild(noneOption);

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        filter.appendChild(option);
    });

    filter.value = Array.from(filter.options).some(option => option.value === currentValue)
        ? currentValue
        : 'all';
}

async function getScopedExportData() {
    const [records, projects] = await Promise.all([
        loadFromStorage('chatlog_records'),
        loadFromStorage('chatlog_projects')
    ]);
    const safeRecords = records || [];
    const safeProjects = projects || [];
    const scope = document.getElementById('export-project-filter')?.value || 'all';

    if (scope === 'all') {
        return { records: safeRecords, projects: safeProjects, scope, scopeName: 'completo' };
    }
    if (scope === 'none') {
        return {
            records: safeRecords.filter(record => !record.projectId),
            projects: [],
            scope,
            scopeName: 'sin_proyecto'
        };
    }

    const selectedProject = safeProjects.find(project => project.id === scope);
    return {
        records: safeRecords.filter(record => record.projectId === scope),
        projects: selectedProject ? [selectedProject] : [],
        scope,
        scopeName: selectedProject ? sanitizeFilenamePart(selectedProject.name) : 'proyecto'
    };
}

async function exportAllData() {
    const { records, projects, scope, scopeName } = await getScopedExportData();

    const data = {
        records,
        projects,
        metadata: {
            version: '1.0',
            appVersion: getChatLogVersion(),
            exportDate: new Date().toISOString(),
            type: scope === 'all' ? 'full' : 'project',
            scope,
            schema: 'chatlog-internal-v1'
        }
    };

    downloadJSON(data, `chatlog_backup_${scopeName}`, { scope, records, projects });
}

async function exportCSV() {
    const { records, projects, scope, scopeName } = await getScopedExportData();

    if (records.length === 0) {
        ui.showAppStatus('No hay registros para exportar.', 'error');
        return;
    }

    const projectsMap = Object.create(null);
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    const headers = [
        'Nombre del Proyecto', 'ID del proyecto', 'Nombre de la interacción',
        'Fecha de interacción', 'Empresa proveedora', 'Modelo y versión',
        'Liga a la interacción', 'Prompt', 'Etiquetas', 'Etapa del trabajo',
        'Verificación humana y responsabilidad', 'Observaciones', 'Calificación', 'Importante',
        'Tipo de evidencia', 'Referencia de evidencia'
    ];

    let csvContent = headers.join(',') + '\n';

    records.forEach(record => {
        const row = [
            escapeCsvValue(record.projectId ? projectsMap[record.projectId] || 'Proyecto Desconocido' : 'Sin proyecto'),
            escapeCsvValue(record.projectId || ''),
            escapeCsvValue(record.interactionName),
            escapeCsvValue(record.interactionDate || ''),
            escapeCsvValue(record.providerCompany || ''),
            escapeCsvValue(`${record.llmName}${record.llmVersion ? ` (${record.llmVersion})` : ''}`),
            escapeCsvValue(record.interactionLink || ''),
            escapeCsvValue(record.prompt),
            escapeCsvValue(Array.isArray(record.tags) ? record.tags.join('; ') : ''),
            escapeCsvValue(record.ethicalNotes || ''),
            escapeCsvValue(record.biasNotes || ''),
            escapeCsvValue(record.observations || ''),
            escapeCsvValue(record.rating || '0'),
            escapeCsvValue(record.isImportant ? 'Sí' : 'No'),
            escapeCsvValue(getEvidenceType(record)),
            escapeCsvValue(record.evidenceReference || '')
        ];
        csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8' });
    const filename = `chatlog_registros_${scopeName}_${new Date().toISOString().split('T')[0]}.csv`;
    downloadExport(blob, filename, { scope, records, projects });
}

async function importData() {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files[0];
    const importMode = document.getElementById('import-mode').value;

    if (!file) {
        ui.showAppStatus('Selecciona un archivo JSON para importar.', 'error');
        return;
    }

    const actionDescription = importMode === 'replace'
        ? 'Se eliminarán los proyectos y registros actuales y se reemplazarán con los del archivo.'
        : 'Los datos del archivo se fusionarán con los actuales; los identificadores ya existentes se conservarán sin duplicarse.';
    if (!await ui.appConfirm(`${actionDescription}\n\n¿Deseas continuar?`, {
        title: 'Importar datos',
        confirmLabel: 'Importar',
        danger: importMode === 'replace'
    })) return;

    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            const importedData = JSON.parse(e.target.result);
            let importedRecordsForReport = [];
            let importedProjectCount = 0;
            let skippedRecordCount = 0;
            let skippedProjectCount = 0;

            if (!importedData.metadata || !importedData.metadata.version) {
                throw new Error('El archivo no parece ser un respaldo válido de ChatLog.');
            }
            if (!Array.isArray(importedData.records)) {
                throw new Error('El respaldo no contiene una lista válida de registros.');
            }
            if (
                ['full', 'project'].includes(importedData.metadata.type) &&
                !Array.isArray(importedData.projects)
            ) {
                throw new Error('El respaldo no contiene una lista válida de proyectos.');
            }

            if (!await ui.flushRecordAutosave()) throw new Error('No se pudo guardar el formulario activo. Reintenta su guardado antes de importar.');
            const [existingRecords, existingProjects] = await Promise.all([
                readCollectionForUpdate('chatlog_records'), readCollectionForUpdate('chatlog_projects')
            ]);
            if (!existingRecords || !existingProjects) throw new Error('No se pudieron leer los datos actuales; se conserva el archivo seleccionado.');
            const shouldImportProjects = Boolean(
                importedData.projects &&
                Array.isArray(importedData.projects) &&
                ['full', 'project'].includes(importedData.metadata.type)
            );
            const projectImport = shouldImportProjects
                ? reconcileImportedProjects(importedData.projects, existingProjects, importMode)
                : {
                    projects: existingProjects,
                    projectIdMap: new Map(),
                    importedCount: 0,
                    skippedCount: 0
                };
            importedProjectCount = projectImport.importedCount;
            skippedProjectCount = projectImport.skippedCount;

            const validProjectIds = new Set(projectImport.projects.map(project => String(project.id)));
            const normalizedRecords = normalizeImportedJsonRecords(importedData.records).map(record => {
                if (!record.projectId) return record;

                const sourceProjectId = String(record.projectId);
                const mappedProjectId = projectImport.projectIdMap.get(sourceProjectId) || sourceProjectId;
                return {
                    ...record,
                    projectId: validProjectIds.has(String(mappedProjectId)) ? mappedProjectId : null
                };
            });
            validateImportedRecords(normalizedRecords);
            validateImportedProjects(projectImport.projects);
            let finalRecords;

            if (importMode === 'merge') {
                const seenRecordIds = new Set(existingRecords.map(record => record.id));
                const newRecords = normalizedRecords.filter(record => {
                    if (seenRecordIds.has(record.id)) return false;
                    seenRecordIds.add(record.id);
                    return true;
                });
                importedRecordsForReport = newRecords;
                skippedRecordCount = normalizedRecords.length - newRecords.length;

                finalRecords = [...existingRecords, ...newRecords];
            } else {
                const seenRecordIds = new Set();
                const replacementRecords = normalizedRecords.filter(record => {
                    if (seenRecordIds.has(record.id)) return false;
                    seenRecordIds.add(record.id);
                    return true;
                });
                importedRecordsForReport = replacementRecords;
                skippedRecordCount = normalizedRecords.length - replacementRecords.length;

                finalRecords = replacementRecords;
            }

            const values = { chatlog_records: finalRecords };
            if (shouldImportProjects) values.chatlog_projects = projectImport.projects;
            if (importMode === 'replace') values[ACTIVE_RECORD_DRAFT_KEY] = null;
            if (!await saveStorageValues(values)) throw new Error('Falló el guardado de la importación. Se conserva el archivo seleccionado para reintentar.');
            if (importMode === 'replace') ui.resetRecordForm();

            await ui.loadProjects();
            await ui.loadQuickAccessList();
            await ui.loadProjectsForManagement();
            await ui.initRecordsManagement();

            fileInput.value = '';
            document.getElementById('json-preview-container').style.display = 'none';
            await ui.appAlert(buildImportReport(
                'JSON',
                importedRecordsForReport,
                finalRecords,
                importedProjectCount,
                skippedRecordCount,
                skippedProjectCount
            ), { title: 'Importación completada' });
        } catch (error) {
            console.error('Error al importar datos:', error);
            await ui.appAlert(`Error al importar datos: ${error.message}`, {
                title: 'No se pudieron importar los datos'
            });
        }
    };

    reader.onerror = () => ui.showAppStatus('Error al leer el archivo.', 'error');
    reader.readAsText(file);
}

function previewJSON() {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files[0];
    const previewContainer = document.getElementById('json-preview-container');
    const previewElement = document.getElementById('json-preview');

    if (!file) {
        previewContainer.style.display = 'none';
        previewElement.textContent = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const data = JSON.parse(event.target.result);
            if (!data.metadata?.version) {
                throw new Error('El archivo no contiene metadatos reconocibles de ChatLog.');
            }

            const records = Array.isArray(data.records) ? data.records : [];
            const projects = Array.isArray(data.projects) ? data.projects : [];
            const scopeText = data.metadata.type === 'full'
                ? 'Respaldo completo'
                : 'Respaldo de proyecto o selección';
            const projectNames = projects.slice(0, 5).map(project => project.name).filter(Boolean);
            const lines = [
                `${scopeText}.`,
                `Formato del respaldo: ${data.metadata.version}.`,
                `Proyectos incluidos: ${projects.length}.`,
                `Registros incluidos: ${records.length}.`
            ];
            if (data.metadata.appVersion) {
                lines.splice(1, 0, `Creado con ChatLog ${data.metadata.appVersion}.`);
            }
            if (projectNames.length > 0) {
                lines.push(`Proyectos: ${projectNames.join(', ')}${projects.length > 5 ? ', ...' : ''}.`);
            }

            previewElement.textContent = lines.join('\n');
            previewContainer.style.display = 'block';
        } catch (error) {
            previewElement.textContent = `No se puede importar este archivo: ${error.message}`;
            previewContainer.style.display = 'block';
        }
    };
    reader.onerror = () => {
        previewElement.textContent = 'Error al leer el archivo.';
        previewContainer.style.display = 'block';
    };
    reader.readAsText(file);
}

function previewCSV() {
    const fileInput = document.getElementById('csv-file');
    const file = fileInput.files[0];
    const previewContainer = document.getElementById('csv-preview-container');
    const previewElement = document.getElementById('csv-preview');

    if (!file) {
        previewContainer.style.display = 'none';
        return;
    }

    const reader = new FileReader();

    reader.onload = function(e) {
        try {
            const records = parseCSV(e.target.result);

            if (records.length === 0) {
                previewElement.innerHTML = '<p class="no-data-message">El archivo CSV está vacío o tiene un formato incorrecto.</p>';
                previewContainer.style.display = 'block';
                return;
            }

            const headers = Object.keys(records[0]);
            const table = document.createElement('table');
            const head = document.createElement('thead');
            const headerRow = document.createElement('tr');
            headers.forEach(header => {
                const cell = document.createElement('th');
                cell.textContent = header;
                headerRow.appendChild(cell);
            });
            head.appendChild(headerRow);
            table.appendChild(head);
            const body = document.createElement('tbody');
            records.slice(0, 5).forEach(record => {
                const row = document.createElement('tr');
                headers.forEach(header => {
                    const cell = document.createElement('td');
                    cell.textContent = record[header] || '';
                    row.appendChild(cell);
                });
                body.appendChild(row);
            });
            table.appendChild(body);
            previewElement.replaceChildren(table);
            if (records.length > 5) {
                const note = document.createElement('p');
                note.className = 'text-muted';
                note.textContent = `(Mostrando 5 de ${records.length} filas)`;
                previewElement.appendChild(note);
            }
            previewContainer.style.display = 'block';
        } catch (error) {
            previewElement.textContent = `Error al procesar el archivo CSV: ${error.message}`;
            previewContainer.style.display = 'block';
        }
    };

    reader.onerror = () => {
        previewElement.innerHTML = '<p class="no-data-message">Error al leer el archivo.</p>';
        previewContainer.style.display = 'block';
    };

    reader.readAsText(file);
}

async function importCSV() {
    const fileInput = document.getElementById('csv-file');
    const file = fileInput.files[0];
    const importMode = document.getElementById('import-mode').value;

    if (!file) {
        ui.showAppStatus('Selecciona un archivo CSV para importar.', 'error');
        return;
    }

    const actionDescription = importMode === 'replace'
        ? 'Se reemplazarán los proyectos y registros actuales con los datos del archivo CSV.'
        : 'Los registros del archivo CSV se agregarán a los datos actuales.';
    if (!await ui.appConfirm(`${actionDescription}\n\n¿Deseas continuar?`, {
        title: 'Importar registros',
        confirmLabel: 'Importar',
        danger: importMode === 'replace'
    })) return;

    const reader = new FileReader();

    reader.onload = async function(e) {
        try {
            const csvRecords = parseCSV(e.target.result);

            if (csvRecords.length === 0) {
                ui.showAppStatus('El archivo CSV está vacío o tiene un formato incorrecto.', 'error');
                return;
            }

            const firstRecord = csvRecords[0];
            const fieldMapping = {};

            Object.keys(firstRecord).forEach(key => {
                const k = key.toLowerCase();
                if (k.includes('nombre del proyecto') || k === 'proyecto') fieldMapping.projectName = key;
                else if (k.includes('id del proyecto') || k === 'id proyecto') fieldMapping.projectId = key;
                else if (k.includes('fecha de interacción') || k.includes('fecha de interaccion')) fieldMapping.interactionDate = key;
                else if (k.includes('empresa proveedora') || k.includes('proveedor')) fieldMapping.providerCompany = key;
                else if (k === 'tipo de evidencia') fieldMapping.evidenceType = key;
                else if (k === 'referencia de evidencia') fieldMapping.evidenceReference = key;
                else if (k.includes('liga a la interacción') || k.includes('liga a la interaccion') || k.includes('enlace') || k.includes('link') || k.includes('url')) fieldMapping.link = key;
                else if (k.includes('nombre de la interacción') || k.includes('nombre') || k.includes('interacción')) fieldMapping.name = key;
                else if (k.includes('finalidad') || k.includes('propósito') || k.includes('proposito') || k.includes('purpose')) fieldMapping.purpose = key;
                else if (k.includes('modelo y versión') || k.includes('modelo') || k.includes('llm')) fieldMapping.model = key;
                else if (k.includes('prompt') || k.includes('consulta')) fieldMapping.prompt = key;
                else if (k.includes('etiquetas') || k.includes('tags')) fieldMapping.tags = key;
                else if (k.includes('etapa del trabajo') || k.includes('aspectos éticos') || k.includes('ética') || k.includes('ethic')) fieldMapping.ethics = key;
                else if (k.includes('verificación humana') || k.includes('verificacion humana') || k.includes('responsabilidad') || k.includes('notas sobre mitigación') || k.includes('mitigación') || k.includes('sesgo') || k.includes('bias')) fieldMapping.bias = key;
                else if (k.includes('observaciones') || k.includes('observa') || k.includes('nota') || k.includes('note')) fieldMapping.notes = key;
                else if (k.includes('calificación') || k.includes('rating') || k.includes('stars') || k.includes('estrella')) fieldMapping.rating = key;
                else if (k.includes('importante') || k.includes('destacado') || k.includes('fijado')) fieldMapping.important = key;
            });

            if (!fieldMapping.name && !fieldMapping.model && !fieldMapping.prompt) {
                throw new Error('El CSV no contiene columnas reconocibles de interacción, modelo o prompt.');
            }
            if (!await ui.flushRecordAutosave()) throw new Error('No se pudo guardar el formulario activo. Reintenta su guardado antes de importar.');
            const [existingProjects, records] = await Promise.all([
                readCollectionForUpdate('chatlog_projects'), readCollectionForUpdate('chatlog_records')
            ]);
            if (!existingProjects || !records) throw new Error('No se pudieron leer los datos actuales; se conserva el archivo seleccionado.');
            const baseProjects = importMode === 'replace' ? [] : existingProjects;
            const projectsById = new Map(baseProjects.map(project => [project.id, project]));
            const projectsByName = new Map(baseProjects.map(project => [project.name.trim().toLowerCase(), project]));
            const importedProjects = [...baseProjects];

            const resolveProjectId = (csvRecord) => {
                const rawProjectId = fieldMapping.projectId ? (csvRecord[fieldMapping.projectId] || '').trim() : '';
                if (rawProjectId && projectsById.has(rawProjectId)) {
                    return rawProjectId;
                }

                const rawProjectName = fieldMapping.projectName ? (csvRecord[fieldMapping.projectName] || '').trim() : '';
                if (!rawProjectName || rawProjectName.toLowerCase() === 'sin proyecto') {
                    return null;
                }

                const normalizedName = rawProjectName.toLowerCase();
                if (projectsByName.has(normalizedName)) {
                    return projectsByName.get(normalizedName).id;
                }

                const newProject = {
                    id: generateUniqueId('project'),
                    name: rawProjectName,
                    dateCreated: new Date().toISOString()
                };

                importedProjects.push(newProject);
                projectsById.set(newProject.id, newProject);
                projectsByName.set(normalizedName, newProject);
                return newProject.id;
            };

            const newRecords = csvRecords.map(csvRecord => {
                const modelFull = csvRecord[fieldMapping.model] || 'Sin especificar';
                let model = modelFull;
                let version = '';

                const match = modelFull.match(/(.+)\s*\((.+)\)/);
                if (match) { model = match[1].trim(); version = match[2].trim(); }

                return {
                    id: generateUniqueId('record'),
                    interactionName: csvRecord[fieldMapping.name] || 'Importado desde CSV',
                    purpose: csvRecord[fieldMapping.purpose] || 'Sin especificar',
                    interactionDate: fieldMapping.interactionDate ? csvRecord[fieldMapping.interactionDate] : '',
                    providerCompany: fieldMapping.providerCompany ? csvRecord[fieldMapping.providerCompany] : '',
                    llmName: model,
                    llmVersion: version,
                    prompt: fieldMapping.prompt ? csvRecord[fieldMapping.prompt] : '',
                    interactionLink: fieldMapping.link ? csvRecord[fieldMapping.link] : '',
                    ...normalizeImportedEvidence({
                        evidenceType: fieldMapping.evidenceType ? csvRecord[fieldMapping.evidenceType] : '',
                        evidenceReference: fieldMapping.evidenceReference ? csvRecord[fieldMapping.evidenceReference] : ''
                    }),
                    tags: fieldMapping.tags ? csvRecord[fieldMapping.tags].split(/[,;]/).map(t => t.trim()).filter(Boolean) : [],
                    ethicalNotes: fieldMapping.ethics ? csvRecord[fieldMapping.ethics] : '',
                    biasNotes: fieldMapping.bias ? csvRecord[fieldMapping.bias] : '',
                    observations: fieldMapping.notes ? csvRecord[fieldMapping.notes] : '',
                    rating: fieldMapping.rating ? csvRecord[fieldMapping.rating] : '0',
                    isImportant: fieldMapping.important
                        ? parseImportedBoolean(csvRecord[fieldMapping.important])
                        : false,
                    projectId: resolveProjectId(csvRecord),
                    dateCreated: new Date().toISOString(),
                    dateModified: new Date().toISOString()
                };
            });

            validateImportedRecords(newRecords);
            validateImportedProjects(importedProjects);
            const importedProjectCount = importedProjects.length - baseProjects.length;
            const finalRecords = importMode === 'replace' ? newRecords : [...records, ...newRecords];
            const values = { chatlog_projects: importedProjects, chatlog_records: finalRecords };
            if (importMode === 'replace') values[ACTIVE_RECORD_DRAFT_KEY] = null;
            if (!await saveStorageValues(values)) throw new Error('Falló el guardado de la importación. Se conserva el archivo seleccionado para reintentar.');
            if (importMode === 'replace') ui.resetRecordForm();

            await ui.loadProjects();
            await ui.loadQuickAccessList();
            await ui.updateAllTags();

            if (document.getElementById('tools').classList.contains('active')) {
                await ui.initRecordsManagement();
            }

            fileInput.value = '';
            document.getElementById('csv-preview-container').style.display = 'none';
            await ui.appAlert(
                buildImportReport('CSV', newRecords, finalRecords, importedProjectCount),
                { title: 'Importación completada' }
            );
        } catch (error) {
            console.error('Error al importar CSV:', error);
            await ui.appAlert(`Error al importar el archivo CSV: ${error.message}`, {
                title: 'No se pudo importar el archivo'
            });
        }
    };

    reader.onerror = () => ui.showAppStatus('Error al leer el archivo.', 'error');
    reader.readAsText(file);
}

Object.assign(ui, { exportAllData, exportCSV, importData, importCSV, previewJSON, previewCSV, populateExportProjectFilter });

export { exportAllData, exportCSV, importData, importCSV, previewJSON, previewCSV, populateExportProjectFilter };
