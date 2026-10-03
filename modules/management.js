import { qualityRulesSignature } from './records.js';
import { appState, ui } from './runtime.js';

import { loadFromStorage, readCollectionForUpdate, saveToStorage } from './storage.js';

import { buildDuplicateRecordMap, evaluateRecordQuality, generateUniqueId, getEvidenceLabel, getEvidenceValue } from './records.js';

let searchTimer = null;
let managementAnalysisCache = null;
let managementTagFilterCache = null;

function scheduleManagementSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { searchTimer = null; void loadRecordsForManagement(); }, 180);
}

function getManagementAnalysis(records, projects) {
    const signature = qualityRulesSignature();
    if (managementAnalysisCache?.records === records && (managementAnalysisCache.projects === projects || (!projects.length && !managementAnalysisCache.projects.length)) &&
        managementAnalysisCache.signature === signature) return managementAnalysisCache;
    const duplicateRecords = buildDuplicateRecordMap(records);
    const searchable = new Map(records.map(record => [record.id, [record.interactionName, record.purpose,
        record.llmName, record.llmVersion, record.prompt, record.interactionLink, record.evidenceReference,
        record.ethicalNotes, record.biasNotes, record.observations,
        ...(Array.isArray(record.tags) ? record.tags : [])].map(value => String(value || '').toLowerCase())]));
    const qualityCounts = {incomplete: 0, warning: 0, ready: 0};
    records.forEach(record => qualityCounts[evaluateRecordQuality(record).status]++);
    managementAnalysisCache = {records, projects, signature, duplicateRecords, searchable, qualityCounts};
    return managementAnalysisCache;
}

function setupToolsTab() {
    document.getElementById('export-all-btn').addEventListener('click', ui.exportAllData);
    document.getElementById('export-csv-btn').addEventListener('click', ui.exportCSV);
    document.getElementById('import-data-btn').addEventListener('click', ui.importData);
    document.getElementById('import-csv-btn').addEventListener('click', ui.importCSV);
    document.getElementById('import-file').addEventListener('change', ui.previewJSON);
    document.getElementById('csv-file').addEventListener('change', ui.previewCSV);

    document.getElementById('save-project-edit-btn').addEventListener('click', saveProjectEdit);
    document.getElementById('cancel-project-edit-btn').addEventListener('click', cancelProjectEdit);

    document.getElementById('records-search-filter').addEventListener('input', scheduleManagementSearch);
    document.getElementById('records-project-filter').addEventListener('change', handleRecordsProjectFilterChange);
    document.getElementById('records-tags-filter').addEventListener('change', loadRecordsForManagement);
    document.getElementById('records-quality-filter').addEventListener('change', loadRecordsForManagement);
    document.getElementById('records-sort-by').addEventListener('change', loadRecordsForManagement);
    document.getElementById('select-visible-records-btn').addEventListener('click', selectVisibleManagementRecords);
    document.getElementById('clear-record-selection-btn').addEventListener('click', clearManagementRecordSelection);
    document.getElementById('mark-selected-important-btn').addEventListener('click', markSelectedRecordsImportant);
    document.getElementById('delete-selected-records-btn').addEventListener('click', deleteSelectedRecords);
    document.querySelectorAll('.quality-filter-card').forEach(card => {
        card.addEventListener('click', () => showRecordsByQuality(card.dataset.qualityFilter));
    });

    document.getElementById('save-reminder-settings-btn').addEventListener('click', ui.saveReminderSettings);
    document.getElementById('save-quality-rules-btn').addEventListener('click', ui.saveQualityReviewSettings);
}

async function loadProjectsForManagement() {
    const projects = [...(await loadFromStorage('chatlog_projects') || [])];
    const tableBody = document.querySelector('#projects-management-table tbody');

    if (projects.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="no-data-message">No hay proyectos disponibles</td></tr>';
        return;
    }

    projects.sort((a, b) => a.name.localeCompare(b.name));

    const records = await loadFromStorage('chatlog_records') || [];
    const projectHealth = Object.create(null);
    records.forEach(record => {
        if (record.projectId) {
            if (!projectHealth[record.projectId]) {
                projectHealth[record.projectId] = { total: 0, ready: 0 };
            }
            projectHealth[record.projectId].total += 1;
            if (evaluateRecordQuality(record).status === 'ready') {
                projectHealth[record.projectId].ready += 1;
            }
        }
    });

    tableBody.innerHTML = '';

    projects.forEach(project => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = project.name;

        const dateCell = document.createElement('td');
        dateCell.textContent = new Date(project.dateCreated).toLocaleDateString();

        const recordsCell = document.createElement('td');
        const health = projectHealth[project.id] || { total: 0, ready: 0 };
        recordsCell.textContent = `${health.total} (${health.ready} listos, ${health.total - health.ready} por revisar)`;

        const actionsCell = document.createElement('td');
        const actionButtons = document.createElement('div');
        actionButtons.className = 'action-buttons';

        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', () => editProject(project));

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.textContent = 'Eliminar';
        deleteBtn.addEventListener('click', async () => {
            if (await ui.appConfirm(
                `¿Deseas eliminar el proyecto "${project.name}"?`,
                { title: 'Eliminar proyecto', confirmLabel: 'Eliminar', danger: true }
            )) {
                await ui.deleteProjectById(project.id);
            }
        });

        actionButtons.appendChild(editBtn);
        actionButtons.appendChild(deleteBtn);
        actionsCell.appendChild(actionButtons);

        row.appendChild(nameCell);
        row.appendChild(dateCell);
        row.appendChild(recordsCell);
        row.appendChild(actionsCell);

        tableBody.appendChild(row);
    });
}

function editProject(project) {
    const editForm = document.getElementById('edit-project-form');
    document.getElementById('edit-project-id').value = project.id;
    const projectNameInput = document.getElementById('edit-project-name');
    projectNameInput.value = project.name;
    editForm.style.display = 'block';
    projectNameInput.focus();
    editForm.scrollIntoView({ behavior: 'smooth' });
}

async function saveProjectEdit() {
    const projectId = document.getElementById('edit-project-id').value;
    const projectName = document.getElementById('edit-project-name').value.trim();

    if (!projectName) {
        ui.showAppStatus('Por favor, ingresa un nombre para el proyecto.', 'error');
        document.getElementById('edit-project-name').focus();
        return;
    }

    const projects = await readCollectionForUpdate('chatlog_projects');
    if (!projects) return;

    if (projects.some(p => p.name.toLowerCase() === projectName.toLowerCase() && p.id !== projectId)) {
        ui.showAppStatus('Ya existe otro proyecto con ese nombre.', 'error');
        document.getElementById('edit-project-name').focus();
        return;
    }

    const updatedProjects = projects.map(project =>
        project.id === projectId ? { ...project, name: projectName } : project
    );

    const saved = await saveToStorage('chatlog_projects', updatedProjects);
    if (saved) {
        ui.showAppStatus('Proyecto actualizado correctamente.');
        await ui.loadProjects();
        await loadProjectsForManagement();
        await initRecordsManagement();
        cancelProjectEdit();
    }
}

function cancelProjectEdit() {
    document.getElementById('edit-project-form').style.display = 'none';
    document.getElementById('edit-project-id').value = '';
    document.getElementById('edit-project-name').value = '';
}

async function initRecordsManagement() {
    const projectFilter = document.getElementById('records-project-filter');

    const projects = await loadFromStorage('chatlog_projects') || [];
    const allOption = projectFilter.options[0];
    projectFilter.innerHTML = '';
    projectFilter.appendChild(allOption);

    const noneOption = document.createElement('option');
    noneOption.value = 'none';
    noneOption.textContent = 'Sin proyecto';
    projectFilter.appendChild(noneOption);

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        projectFilter.appendChild(option);
    });

    ui.populateExportProjectFilter(projects);
    await loadRecordsForManagement();
}

async function handleRecordsProjectFilterChange() {
    document.getElementById('records-tags-filter').value = '';
    await loadRecordsForManagement();
}

function updateManagementTagFilter(records, projectFilter) {
    if (managementTagFilterCache?.records === records && managementTagFilterCache.projectFilter === projectFilter) return;
    managementTagFilterCache = {records, projectFilter};
    const tagFilter = document.getElementById('records-tags-filter');
    const currentValue = tagFilter.value;
    const relevantRecords = records.filter(record => {
        if (projectFilter === 'all') return true;
        if (projectFilter === 'none') return !record.projectId;
        return record.projectId === projectFilter;
    });
    const tags = Array.from(new Set(
        relevantRecords.flatMap(record => Array.isArray(record.tags) ? record.tags : [])
    )).sort((a, b) => a.localeCompare(b, 'es'));

    tagFilter.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = tags.length > 0 ? 'Todas las etiquetas' : 'No hay etiquetas en este proyecto';
    tagFilter.appendChild(allOption);

    tags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag;
        option.textContent = tag;
        tagFilter.appendChild(option);
    });

    tagFilter.disabled = tags.length === 0;
    tagFilter.value = tags.includes(currentValue) ? currentValue : '';
}

async function loadRecordsForManagement() {
    clearTimeout(searchTimer);
    searchTimer = null;
    const records = await loadFromStorage('chatlog_records') || [];
    const projects = await loadFromStorage('chatlog_projects') || [];
    const searchFilter = document.getElementById('records-search-filter').value.trim().toLowerCase();
    const projectFilter = document.getElementById('records-project-filter').value;
    updateManagementTagFilter(records, projectFilter);
    const tagsFilter = document.getElementById('records-tags-filter').value.trim().toLowerCase();
    const qualityFilter = document.getElementById('records-quality-filter').value;
    const sortBy = document.getElementById('records-sort-by').value;
    const analysis = getManagementAnalysis(records, projects);
    const duplicateRecords = analysis.duplicateRecords;

    updateRecordsQualitySummary(records, duplicateRecords, analysis.qualityCounts);
    updateQualityFilterCardState(qualityFilter);
    const existingRecordIds = new Set(records.map(record => record.id));
    appState.managementSelectedRecords.forEach(recordId => {
        if (!existingRecordIds.has(recordId)) appState.managementSelectedRecords.delete(recordId);
    });

    if (records.length === 0) {
        appState.managementVisibleRecordIds = [];
        updateManagementSelectionControls();
        document.getElementById('records-by-project').innerHTML = '<div class="no-data-message">No hay registros disponibles</div>';
        return;
    }

    const projectsMap = Object.create(null);
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    let filteredRecords = [...records];
    if (searchFilter) {
        filteredRecords = filteredRecords.filter(record => {
            const projectName = record.projectId ? (projectsMap[record.projectId] || '') : 'Sin proyecto';
            return analysis.searchable.get(record.id).some(value => value.includes(searchFilter)) ||
                String(projectName).toLowerCase().includes(searchFilter);
        });
    }
    if (projectFilter !== 'all') {
        if (projectFilter === 'none') {
            filteredRecords = filteredRecords.filter(record => !record.projectId);
        } else {
            filteredRecords = filteredRecords.filter(record => record.projectId === projectFilter);
        }
    }
    if (tagsFilter) {
        filteredRecords = filteredRecords.filter(record =>
            Array.isArray(record.tags) &&
            record.tags.some(tag => String(tag).trim().toLowerCase() === tagsFilter)
        );
    }
    if (qualityFilter !== 'all') {
        filteredRecords = filteredRecords.filter(record => {
            const quality = evaluateRecordQuality(record);
            if (qualityFilter === 'duplicate') return duplicateRecords.has(record.id);
            if (qualityFilter === 'important') return Boolean(record.isImportant);
            if (qualityFilter === 'no-project') return !record.projectId;
            return quality.status === qualityFilter;
        });
    }

    sortRecords(filteredRecords, sortBy, duplicateRecords);
    appState.managementVisibleRecordIds = filteredRecords.map(record => record.id);
    const visibleIds = new Set(appState.managementVisibleRecordIds);
    appState.managementSelectedRecords.forEach(recordId => {
        if (!visibleIds.has(recordId)) appState.managementSelectedRecords.delete(recordId);
    });
    updateManagementSelectionControls();

    const recordsByProject = Object.create(null);
    recordsByProject.none = { name: 'Sin proyecto', records: [] };
    projects.forEach(project => {
        recordsByProject[project.id] = { name: project.name, records: [] };
    });

    filteredRecords.forEach(record => {
        const projectId = record.projectId || 'none';
        if (recordsByProject[projectId]) {
            recordsByProject[projectId].records.push(record);
        } else {
            recordsByProject['none'].records.push(record);
        }
    });

    const recordsContainer = document.getElementById('records-by-project');
    recordsContainer.innerHTML = '';

    Object.keys(recordsByProject).forEach(projectId => {
        const projectGroup = recordsByProject[projectId];
        if (projectGroup.records.length === 0) return;
        const readyCount = projectGroup.records.filter(record =>
            evaluateRecordQuality(record).status === 'ready'
        ).length;

        const groupElement = document.createElement('div');
        groupElement.className = 'project-group';

        const headerElement = document.createElement('div');
        headerElement.className = 'project-header';
        headerElement.setAttribute('data-project-id', projectId);
        headerElement.setAttribute('role', 'button');
        headerElement.setAttribute('tabindex', '0');
        headerElement.setAttribute('aria-expanded', 'false');
        const recordsListId = `project-records-${String(projectId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
        headerElement.setAttribute('aria-controls', recordsListId);
        const name = document.createElement('div');
        name.className = 'project-name';
        name.textContent = projectGroup.name;
        const count = document.createElement('div');
        count.className = 'project-count';
        count.textContent = `${projectGroup.records.length} registros · ${readyCount} listos · ${projectGroup.records.length - readyCount} por revisar`;
        headerElement.appendChild(name);
        headerElement.appendChild(count);
        let rendered = false;
        const toggleProjectGroup = () => {
            const isExpanded = recordsListElement.classList.toggle('expanded');
            if (isExpanded && !rendered) {
                const fragment = document.createDocumentFragment();
                projectGroup.records.forEach(record => fragment.appendChild(createRecordElement(record, projectsMap, duplicateRecords)));
                recordsListElement.appendChild(fragment);
                rendered = true;
            }
            headerElement.setAttribute('aria-expanded', String(isExpanded));
        };
        headerElement.addEventListener('click', toggleProjectGroup);
        headerElement.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleProjectGroup();
            }
        });

        const recordsListElement = document.createElement('div');
        recordsListElement.className = 'project-records';
        recordsListElement.id = recordsListId;

        groupElement.appendChild(headerElement);
        groupElement.appendChild(recordsListElement);
        recordsContainer.appendChild(groupElement);
    });

    if (recordsContainer.children.length === 0) {
        recordsContainer.innerHTML = '<div class="no-data-message">No hay registros que coincidan con los filtros aplicados</div>';
    }
}

function updateManagementSelectionControls() {
    const selectedCount = appState.managementSelectedRecords.size;
    const visibleCount = appState.managementVisibleRecordIds.length;
    const countLabel = document.getElementById('records-selection-count');
    const selectVisibleButton = document.getElementById('select-visible-records-btn');
    const clearButton = document.getElementById('clear-record-selection-btn');
    const importantButton = document.getElementById('mark-selected-important-btn');
    const deleteButton = document.getElementById('delete-selected-records-btn');

    countLabel.textContent = selectedCount === 1
        ? '1 registro seleccionado'
        : `${selectedCount} registros seleccionados`;
    selectVisibleButton.disabled = visibleCount === 0 || selectedCount === visibleCount;
    clearButton.disabled = selectedCount === 0;
    importantButton.disabled = selectedCount === 0;
    deleteButton.disabled = selectedCount === 0;
}

function setManagementRecordSelected(recordId, selected, recordElement = null) {
    if (selected) appState.managementSelectedRecords.add(recordId);
    else appState.managementSelectedRecords.delete(recordId);

    const row = recordElement || document.querySelector(`.record-row[data-record-id="${CSS.escape(recordId)}"]`);
    if (row) row.classList.toggle('is-selected', selected);
    updateManagementSelectionControls();
}

function selectVisibleManagementRecords() {
    appState.managementVisibleRecordIds.forEach(recordId => appState.managementSelectedRecords.add(recordId));
    document.querySelectorAll('.management-record-checkbox').forEach(checkbox => {
        checkbox.checked = true;
        checkbox.closest('.record-row')?.classList.add('is-selected');
    });
    updateManagementSelectionControls();
}

function clearManagementRecordSelection() {
    appState.managementSelectedRecords.clear();
    document.querySelectorAll('.management-record-checkbox').forEach(checkbox => {
        checkbox.checked = false;
        checkbox.closest('.record-row')?.classList.remove('is-selected');
    });
    updateManagementSelectionControls();
}

async function markSelectedRecordsImportant() {
    const selectedIds = new Set(appState.managementSelectedRecords);
    if (selectedIds.size === 0) return;

    const records = await readCollectionForUpdate('chatlog_records');
    if (!records) return;
    let updatedCount = 0;
    const modifiedAt = new Date().toISOString();
    records.forEach(record => {
        if (selectedIds.has(record.id) && !record.isImportant) {
            record.isImportant = true;
            record.dateModified = modifiedAt;
            updatedCount += 1;
        }
    });

    if (updatedCount === 0) {
        ui.showAppStatus('Los registros seleccionados ya estaban marcados como importantes.', 'info');
        return;
    }

    const saved = await saveToStorage('chatlog_records', records);
    if (saved) {
        clearManagementRecordSelection();
        await Promise.all([loadRecordsForManagement(), ui.loadQuickAccessList()]);
        if (appState.initializedTabs.has('stats')) await ui.loadStatistics();
        ui.showAppStatus(
            updatedCount === 1
                ? 'El registro seleccionado quedó marcado como importante.'
                : `${updatedCount} registros quedaron marcados como importantes.`
        );
    }
}

async function deleteSelectedRecords() {
    const selectedIds = new Set(appState.managementSelectedRecords);
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmationText = count === 1
        ? '¿Deseas eliminar el registro seleccionado? Esta acción no se puede deshacer.'
        : `¿Deseas eliminar los ${count} registros seleccionados? Esta acción no se puede deshacer.`;
    if (!await ui.appConfirm(confirmationText, {
        title: 'Eliminar registros',
        confirmLabel: 'Eliminar',
        danger: true
    })) return;

    const editingRecordId = document.getElementById('record-id').value;
    if (editingRecordId && selectedIds.has(editingRecordId)) {
        ui.cancelRecordAutosave(true);
    }
    await appState.recordAutosaveQueue.catch(() => {});

    const records = await readCollectionForUpdate('chatlog_records');
    if (!records) return;
    const existingSelectedIds = new Set(
        records.filter(record => selectedIds.has(record.id)).map(record => record.id)
    );
    if (existingSelectedIds.size === 0) {
        clearManagementRecordSelection();
        ui.showAppStatus('Los registros seleccionados ya no existen.', 'error');
        return;
    }

    const remainingRecords = records.filter(record => !existingSelectedIds.has(record.id));
    const saved = await saveToStorage('chatlog_records', remainingRecords);
    if (saved) {
        if (editingRecordId && existingSelectedIds.has(editingRecordId)) ui.resetRecordForm();
        appState.managementSelectedRecords.clear();

        const refreshTasks = [
            loadRecordsForManagement(),
            ui.loadQuickAccessList(),
            ui.updateAllTags(),
            loadProjectsForManagement()
        ];
        if (appState.initializedTabs.has('declaration')) {
            refreshTasks.push(ui.loadRecordsForDeclaration());
        }
        await Promise.all(refreshTasks);
        if (appState.initializedTabs.has('stats')) await ui.loadStatistics();

        const deletedCount = existingSelectedIds.size;
        ui.showAppStatus(
            deletedCount === 1
                ? 'El registro seleccionado se eliminó correctamente.'
                : `${deletedCount} registros se eliminaron correctamente.`
        );
    }
}

function updateQualityFilterCardState(activeFilter) {
    document.querySelectorAll('.quality-filter-card').forEach(card => {
        card.setAttribute('aria-pressed', String(card.dataset.qualityFilter === activeFilter));
    });
}

async function showRecordsByQuality(qualityFilter) {
    const filterSelect = document.getElementById('records-quality-filter');
    filterSelect.value = qualityFilter;
    await loadRecordsForManagement();

    const recordsContainer = document.getElementById('records-by-project');
    recordsContainer.querySelectorAll('.project-group').forEach(group => {
        group.querySelector('.project-records').classList.add('expanded');
        group.querySelector('.project-header').setAttribute('aria-expanded', 'true');
    });

    recordsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const firstEditButton = recordsContainer.querySelector('.record-row .record-edit-btn');
    if (firstEditButton) firstEditButton.focus({ preventScroll: true });
    else ui.showAppStatus('No hay registros que coincidan con este aviso.', 'info');
}

function createRecordElement(record, projectsMap, duplicateRecords) {
    const recordElement = document.createElement('div');
    recordElement.className = 'record-row';
    recordElement.setAttribute('data-record-id', record.id);
    recordElement.classList.toggle('is-selected', appState.managementSelectedRecords.has(record.id));

    const selectionContainer = document.createElement('div');
    selectionContainer.className = 'record-selection';
    const selectionCheckbox = document.createElement('input');
    selectionCheckbox.type = 'checkbox';
    selectionCheckbox.className = 'management-record-checkbox';
    selectionCheckbox.checked = appState.managementSelectedRecords.has(record.id);
    selectionCheckbox.setAttribute('aria-label', `Seleccionar registro: ${record.interactionName}`);
    selectionCheckbox.addEventListener('change', () => {
        setManagementRecordSelected(record.id, selectionCheckbox.checked, recordElement);
    });
    selectionContainer.appendChild(selectionCheckbox);

    const infoElement = document.createElement('div');
    infoElement.className = 'record-info';

    const nameElement = document.createElement('div');
    nameElement.className = 'record-name';
    if (record.isImportant) {
        const importantMarker = document.createElement('span');
        importantMarker.className = 'important-record-marker';
        importantMarker.textContent = 'Importante:';
        nameElement.appendChild(importantMarker);
    }
    nameElement.appendChild(document.createTextNode(record.interactionName || 'Borrador sin nombre'));

    if (record.rating && parseInt(record.rating) > 0) {
        const ratingSpan = document.createElement('span');
        ratingSpan.className = 'record-rating';
        ratingSpan.innerHTML = '★'.repeat(parseInt(record.rating));
        nameElement.appendChild(ratingSpan);
    }

    const detailsElement = document.createElement('div');
    detailsElement.className = 'record-details';
    const formattedDate = new Date(record.dateModified).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric'
    });
    const quality = evaluateRecordQuality(record);
    const issuesText = quality.issues.length > 0 ? `: ${quality.issues.join(', ')}` : '';
    const duplicateCount = duplicateRecords.get(record.id);
    const duplicateText = duplicateCount
        ? `; Posible duplicado: ${duplicateCount} registros coincidentes`
        : '';
    const priority = quality.status === 'incomplete'
        ? 'Crítica'
        : (duplicateCount ? 'Alta' : (quality.status === 'warning' ? 'Media' : 'Sin problemas'));
    detailsElement.textContent = `${record.llmName || 'Modelo no especificado'} - ${formattedDate} - Estado: ${quality.label} - Prioridad: ${priority}${issuesText}${duplicateText}`;

    infoElement.appendChild(nameElement);
    infoElement.appendChild(detailsElement);

    const actionsElement = document.createElement('div');
    actionsElement.className = 'record-actions';

    const detailPanelId = `record-detail-${String(record.id).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const detailBtn = document.createElement('button');
    detailBtn.className = 'edit-btn';
    detailBtn.textContent = 'Ver detalles';
    detailBtn.setAttribute('aria-expanded', 'false');
    detailBtn.setAttribute('aria-controls', detailPanelId);

    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn record-edit-btn';
    editBtn.textContent = 'Editar';
    editBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        editRecord(record.id);
    });

    const duplicateBtn = document.createElement('button');
    duplicateBtn.className = 'edit-btn';
    duplicateBtn.textContent = 'Duplicar';
    duplicateBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        await duplicateRecord(record.id);
    });

    const moveBtn = document.createElement('button');
    moveBtn.className = 'edit-btn';
    moveBtn.textContent = 'Mover';
    moveBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        await moveRecordToProject(record.id);
    });

    const importantBtn = document.createElement('button');
    importantBtn.className = 'edit-btn important-btn';
    importantBtn.textContent = record.isImportant ? 'Quitar marca' : 'Marcar importante';
    importantBtn.setAttribute('aria-pressed', String(Boolean(record.isImportant)));
    importantBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        await toggleRecordImportance(record.id);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-btn';
    deleteBtn.textContent = 'Eliminar';
    deleteBtn.addEventListener('click', async function(e) {
        e.stopPropagation();
        if (await ui.appConfirm(
            `¿Deseas eliminar el registro "${record.interactionName}"?`,
            { title: 'Eliminar registro', confirmLabel: 'Eliminar', danger: true }
        )) {
            await deleteRecord(record.id);
        }
    });

    let detailPanel = null;
    detailBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (!detailPanel) {
            detailPanel = createRecordDetailPanel(record, projectsMap, detailPanelId);
            recordElement.appendChild(detailPanel);
        }
        const willOpen = detailPanel.hidden;
        detailPanel.hidden = !willOpen;
        detailBtn.setAttribute('aria-expanded', String(willOpen));
        detailBtn.textContent = willOpen ? 'Ocultar detalles' : 'Ver detalles';
    });

    actionsElement.appendChild(detailBtn);
    actionsElement.appendChild(editBtn);
    actionsElement.appendChild(duplicateBtn);
    actionsElement.appendChild(moveBtn);
    actionsElement.appendChild(importantBtn);
    actionsElement.appendChild(deleteBtn);
    recordElement.appendChild(selectionContainer);
    recordElement.appendChild(infoElement);
    recordElement.appendChild(actionsElement);
    return recordElement;
}

function createRecordDetailPanel(record, projectsMap, id) {
    const panel = document.createElement('div');
    panel.id = id;
    panel.className = 'record-detail-panel';
    panel.hidden = true;

    const detailList = document.createElement('dl');
    detailList.className = 'record-detail-list';
    const projectName = record.projectId
        ? (projectsMap[record.projectId] || 'Proyecto desconocido')
        : 'Sin proyecto';
    const model = `${record.llmName || 'Sin especificar'}${record.llmVersion ? ` (${record.llmVersion})` : ''}`;
    const details = [
        ['Proyecto', projectName],
        ['Finalidad', record.purpose || 'Sin especificar'],
        ['Fecha de interacción', record.interactionDate || 'Sin especificar'],
        ['Empresa proveedora', record.providerCompany || 'Sin especificar'],
        ['Modelo', model],
        [getEvidenceLabel(record), getEvidenceValue(record) || 'Sin especificar'],
        ['Prompt', record.prompt || 'Sin especificar'],
        ['Etiquetas', Array.isArray(record.tags) && record.tags.length > 0 ? record.tags.join(', ') : 'Sin etiquetas'],
        ['Etapa del trabajo', record.ethicalNotes || 'Sin especificar'],
        ['Verificación humana y responsabilidad', record.biasNotes || 'Sin especificar'],
        ['Observaciones', record.observations || 'Sin observaciones']
    ];

    details.forEach(([label, value]) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        detailList.appendChild(term);
        detailList.appendChild(description);
    });

    panel.appendChild(detailList);
    return panel;
}

function updateRecordsQualitySummary(records, duplicateRecords, qualityCounts) {
    const summary = {
        total: records.length,
        incomplete: 0,
        warning: 0,
        ready: 0,
        duplicate: duplicateRecords.size
    };

    if (qualityCounts) Object.assign(summary, qualityCounts);
    else records.forEach(record => {summary[evaluateRecordQuality(record).status] += 1;});

    document.getElementById('quality-total-records').textContent = summary.total;
    document.getElementById('quality-incomplete-records').textContent = summary.incomplete;
    document.getElementById('quality-warning-records').textContent = summary.warning;
    document.getElementById('quality-ready-records').textContent = summary.ready;
    document.getElementById('quality-duplicate-records').textContent = summary.duplicate;
}

function sortRecords(records, sortBy, duplicateRecords = new Map()) {
    switch (sortBy) {
        case 'date-desc':
            records.sort((a, b) => new Date(b.dateModified) - new Date(a.dateModified)); break;
        case 'date-asc':
            records.sort((a, b) => new Date(a.dateModified) - new Date(b.dateModified)); break;
        case 'rating-desc':
            records.sort((a, b) => (parseInt(b.rating) || 0) - (parseInt(a.rating) || 0)); break;
        case 'rating-asc':
            records.sort((a, b) => (parseInt(a.rating) || 0) - (parseInt(b.rating) || 0)); break;
        case 'quality': {
            const getPriority = record => {
                const status = evaluateRecordQuality(record).status;
                if (status === 'incomplete') return 0;
                if (duplicateRecords.has(record.id)) return 1;
                if (status === 'warning') return 2;
                return 3;
            };
            records.sort((a, b) => {
                const difference = getPriority(a) - getPriority(b);
                return difference || new Date(b.dateModified) - new Date(a.dateModified);
            });
            break;
        }
        case 'important':
            records.sort((a, b) => {
                const importanceDifference = Number(Boolean(b.isImportant)) - Number(Boolean(a.isImportant));
                return importanceDifference || new Date(b.dateModified) - new Date(a.dateModified);
            });
            break;
        case 'name':
            records.sort((a, b) => a.interactionName.localeCompare(b.interactionName)); break;
    }
}

function editRecord(recordId) {
    document.querySelector('.tab-button[data-tab="main"]').click();
    ui.loadRecordForEdit(recordId);
}

async function duplicateRecord(recordId) {
    const records = await readCollectionForUpdate('chatlog_records');
    if (!records) return;
    const sourceRecord = records.find(record => record.id === recordId);
    if (!sourceRecord) {
        ui.showAppStatus('No se pudo encontrar el registro para duplicarlo.', 'error');
        return;
    }

    const now = new Date().toISOString();
    const duplicatedRecord = {
        ...sourceRecord,
        id: generateUniqueId('record'),
        interactionName: `${sourceRecord.interactionName} (copia)`,
        isImportant: false,
        dateCreated: now,
        dateModified: now
    };
    records.push(duplicatedRecord);

    const saved = await saveToStorage('chatlog_records', records);
    if (saved) {
        await loadRecordsForManagement();
        await ui.loadQuickAccessList();
        await ui.updateAllTags();
        ui.showAppStatus('Registro duplicado. Puedes editar la copia para completar sus cambios.');
    }
}

async function toggleRecordImportance(recordId) {
    const records = await readCollectionForUpdate('chatlog_records');
    if (!records) return;
    const record = records.find(item => item.id === recordId);
    if (!record) {
        ui.showAppStatus('No se pudo encontrar el registro.', 'error');
        return;
    }

    record.isImportant = !record.isImportant;
    record.dateModified = new Date().toISOString();
    const saved = await saveToStorage('chatlog_records', records);
    if (saved) {
        await Promise.all([loadRecordsForManagement(), ui.loadQuickAccessList()]);
        ui.showAppStatus(
            record.isImportant
                ? `El registro "${record.interactionName}" quedó marcado como importante.`
                : `Se quitó la marca de importancia de "${record.interactionName}".`
        );
    }
}

async function moveRecordToProject(recordId) {
    const [records, projects] = await Promise.all([
        readCollectionForUpdate('chatlog_records'),
        readCollectionForUpdate('chatlog_projects')
    ]);
    if (!records || !projects) return;
    const safeRecords = records || [];
    const safeProjects = projects || [];
    const record = safeRecords.find(item => item.id === recordId);
    if (!record) {
        ui.showAppStatus('No se pudo encontrar el registro para moverlo.', 'error');
        return;
    }

    const projectOptions = ['0. Sin proyecto']
        .concat(safeProjects.map((project, index) => `${index + 1}. ${project.name}`))
        .join('\n');
    const selection = prompt(
        `Escribe el número del proyecto de destino para "${record.interactionName}":\n\n${projectOptions}`,
        record.projectId
            ? String(safeProjects.findIndex(project => project.id === record.projectId) + 1)
            : '0'
    );
    if (selection === null) return;

    const selectedIndex = Number(selection);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > safeProjects.length) {
        ui.showAppStatus('La selección no corresponde a un proyecto válido.', 'error');
        return;
    }

    record.projectId = selectedIndex === 0 ? null : safeProjects[selectedIndex - 1].id;
    record.dateModified = new Date().toISOString();
    const saved = await saveToStorage('chatlog_records', safeRecords);
    if (saved) {
        await loadRecordsForManagement();
        await ui.loadQuickAccessList();
        ui.showAppStatus('Registro movido correctamente.');
    }
}

async function deleteRecord(recordId) {
    if (document.getElementById('record-id').value === recordId) {
        ui.cancelRecordAutosave(true);
    }
    await appState.recordAutosaveQueue.catch(() => {});

    const records = await readCollectionForUpdate('chatlog_records');
    if (!records) return;
    const recordToDelete = records.find(record => record.id === recordId);
    if (!recordToDelete) {
        ui.showAppStatus('No se pudo encontrar el registro para eliminarlo.', 'error');
        return;
    }
    const filteredRecords = records.filter(record => record.id !== recordId);

    const saved = await saveToStorage('chatlog_records', filteredRecords);
    if (saved) {
        if (document.getElementById('record-id').value === recordId) ui.resetRecordForm();

        const refreshTasks = [
            loadRecordsForManagement(),
            ui.loadQuickAccessList(),
            ui.updateAllTags(),
            loadProjectsForManagement()
        ];
        if (appState.initializedTabs.has('declaration')) {
            refreshTasks.push(ui.loadRecordsForDeclaration());
        }
        await Promise.all(refreshTasks);

        if (appState.initializedTabs.has('stats')) await ui.loadStatistics();
        ui.showAppStatus(`El registro "${recordToDelete.interactionName}" se eliminó correctamente.`);
    }
}

Object.assign(ui, { setupToolsTab, loadProjectsForManagement, initRecordsManagement, loadRecordsForManagement });

export { setupToolsTab, loadProjectsForManagement, initRecordsManagement, loadRecordsForManagement, getManagementAnalysis, scheduleManagementSearch };
