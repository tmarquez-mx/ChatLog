import { appState } from './runtime.js';

import { loadFromStorage } from './storage.js';

import { isValidStoredDate } from './records.js';

import { ui } from './runtime.js';

function setupStatisticsTab() {
    document.getElementById('apply-stats-filters-btn').addEventListener('click', applyStatisticsFilters);
    document.getElementById('reset-stats-filters-btn').addEventListener('click', resetStatisticsFilters);
}

async function loadStatistics() {
    const { records, projects } = await getStatisticsData();
    populateStatisticsFilters(records, projects);
    records.length === 0 ? showNoStatsData() : updateStatistics(records, projects);
}

async function getStatisticsData() {
    if (appState.statisticsDataCache?.revision === appState.storageRevision) {
        return appState.statisticsDataCache;
    }

    const [records, projects] = await Promise.all([
        loadFromStorage('chatlog_records'),
        loadFromStorage('chatlog_projects')
    ]);
    appState.statisticsDataCache = {
        revision: appState.storageRevision,
        records: records || [],
        projects: projects || []
    };
    return appState.statisticsDataCache;
}

function populateStatisticsFilters(records, projects) {
    const projectFilter = document.getElementById('stats-project-filter');

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

    const uniqueModels = new Set(records.map(r => r.llmName));

    const modelFilter = document.getElementById('stats-model-filter');
    const allModelOption = modelFilter.options[0];
    modelFilter.innerHTML = '';
    modelFilter.appendChild(allModelOption);

    Array.from(uniqueModels).sort().forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model;
        modelFilter.appendChild(option);
    });
}

async function applyStatisticsFilters() {
    const dateRange = document.getElementById('stats-date-range').value;
    const projectFilter = document.getElementById('stats-project-filter').value;
    const modelFilter = document.getElementById('stats-model-filter').value;

    const statsData = await getStatisticsData();
    let records = statsData.records;

    if (dateRange !== 'all') {
        const currentDate = new Date();
        let startDate = new Date(currentDate);
        if (dateRange === 'month') startDate.setMonth(currentDate.getMonth() - 1);
        else if (dateRange === 'quarter') startDate.setMonth(currentDate.getMonth() - 3);
        else if (dateRange === 'year') startDate.setFullYear(currentDate.getFullYear() - 1);
        records = records.filter(record => new Date(record.dateCreated) >= startDate);
    }

    if (projectFilter !== 'all') {
        records = projectFilter === 'none'
            ? records.filter(record => !record.projectId)
            : records.filter(record => record.projectId === projectFilter);
    }

    if (modelFilter !== 'all') {
        records = records.filter(record => record.llmName === modelFilter);
    }

    records.length === 0 ? showNoStatsData() : updateStatistics(records, statsData.projects);
}

async function resetStatisticsFilters() {
    document.getElementById('stats-date-range').value = 'all';
    document.getElementById('stats-project-filter').value = 'all';
    document.getElementById('stats-model-filter').value = 'all';

    const { records, projects } = await getStatisticsData();
    records.length === 0 ? showNoStatsData() : updateStatistics(records, projects);
}

function showNoStatsData() {
    ['total-interactions', 'total-models', 'total-projects', 'total-purposes'].forEach(id => {
        document.getElementById(id).textContent = '0';
    });
    ['models-table', 'purposes-table', 'projects-table'].forEach(tableId => {
        document.querySelector(`#${tableId} tbody`).innerHTML =
            `<tr><td colspan="4" class="no-data-message">No hay datos disponibles</td></tr>`;
    });
    document.querySelector('#models-by-project-table tbody').innerHTML =
        '<tr><td colspan="3" class="no-data-message">No hay datos disponibles</td></tr>';
    document.querySelector('#tag-pairs-table tbody').innerHTML =
        '<tr><td colspan="2" class="no-data-message">No hay coincidencias disponibles</td></tr>';
    document.getElementById('timeline-container').innerHTML = '<div class="no-data-message">No hay datos disponibles</div>';
    document.getElementById('tags-cloud').innerHTML = '<div class="no-data-message">No hay etiquetas disponibles</div>';
}

function updateStatistics(records, projects) {
    const cached = appState.statisticsDataCache;
    const reusable = cached?.records === records && cached.projects === projects;
    const aggregates = reusable && cached.aggregates ? cached.aggregates : aggregateStatistics(records, projects);
    if (reusable) cached.aggregates = aggregates;
    updateStatsSummary(records, aggregates);
    updateModelsTable(aggregates.modelCounts, records.length);
    updatePurposesTable(aggregates.purposeCounts, records.length);
    updateProjectsTable(aggregates.projectCounts, records.length);
    updateTimeline(aggregates.recordsByDate, aggregates.invalidDateCount);
    updateModelsByProjectTable(aggregates.modelProjectCounts);
    updateTagPairsTable(aggregates.tagPairCounts);
    updateTagsCloud(aggregates.tagCounts);
}

function aggregateStatistics(records, projects) {
    const projectsMap = Object.create(null);
    projects.forEach(project => { projectsMap[project.id] = project.name; });

    const modelCounts = Object.create(null);
    const purposeCounts = Object.create(null);
    const projectCounts = Object.create(null);
    const recordsByDate = Object.create(null);
    const tagCounts = Object.create(null);
    const modelProjectCounts = Object.create(null);
    const tagPairCounts = Object.create(null);
    let invalidDateCount = 0;
    const projectIds = new Set();

    records.forEach(record => {
        const model = record.llmName || 'Modelo no especificado';
        const purpose = record.purpose || 'Finalidad no especificada';
        modelCounts[model] = (modelCounts[model] || 0) + 1;
        purposeCounts[purpose] = (purposeCounts[purpose] || 0) + 1;

        if (record.projectId) projectIds.add(record.projectId);
        const projectName = record.projectId
            ? (projectsMap[record.projectId] || 'Proyecto desconocido')
            : 'Sin proyecto';
        projectCounts[projectName] = (projectCounts[projectName] || 0) + 1;
        const modelProjectKey = `${projectName}\u0000${record.llmName || 'Modelo no especificado'}`;
        modelProjectCounts[modelProjectKey] = (modelProjectCounts[modelProjectKey] || 0) + 1;

        if (isValidStoredDate(record.dateCreated)) {
            const dateKey = new Date(record.dateCreated).toISOString().split('T')[0];
            recordsByDate[dateKey] = (recordsByDate[dateKey] || 0) + 1;
        } else {
            invalidDateCount += 1;
        }

        if (Array.isArray(record.tags)) {
            const uniqueTags = Array.from(new Set(record.tags.map(tag => String(tag).trim()).filter(Boolean)))
                .sort((a, b) => a.localeCompare(b, 'es'));
            uniqueTags.forEach(tag => {
                tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            });
            for (let firstIndex = 0; firstIndex < uniqueTags.length; firstIndex += 1) {
                for (let secondIndex = firstIndex + 1; secondIndex < uniqueTags.length; secondIndex += 1) {
                    const pairKey = `${uniqueTags[firstIndex]}\u0000${uniqueTags[secondIndex]}`;
                    tagPairCounts[pairKey] = (tagPairCounts[pairKey] || 0) + 1;
                }
            }
        }
    });

    return {
        modelCounts,
        purposeCounts,
        projectCounts,
        recordsByDate,
        tagCounts,
        modelProjectCounts,
        tagPairCounts,
        invalidDateCount,
        projectCount: projectIds.size
    };
}

function updateStatsSummary(records, aggregates) {
    document.getElementById('total-interactions').textContent = records.length;
    document.getElementById('total-models').textContent = Object.keys(aggregates.modelCounts).length;
    document.getElementById('total-projects').textContent = aggregates.projectCount;
    document.getElementById('total-purposes').textContent = Object.keys(aggregates.purposeCounts).length;
}

function buildTableWithBars(tableId, countMap, total, colors) {
    const sorted = Object.keys(countMap).sort((a, b) => countMap[b] - countMap[a]);
    const tableBody = document.querySelector(`#${tableId} tbody`);
    tableBody.innerHTML = '';
    const fragment = document.createDocumentFragment();

    sorted.forEach((key, index) => {
        const count = countMap[key];
        const percentage = ((count / total) * 100).toFixed(1);
        const color = colors[index % colors.length];

        const row = document.createElement('tr');
        [key, String(count), `${percentage}%`].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        const barCell = document.createElement('td');
        const bar = document.createElement('div');
        bar.className = 'progress-bar';
        const fill = document.createElement('div');
        fill.className = 'progress-fill';
        fill.style.width = `${percentage}%`;
        fill.style.backgroundColor = color;
        bar.appendChild(fill);
        barCell.appendChild(bar);
        row.appendChild(barCell);
        fragment.appendChild(row);
    });
    tableBody.appendChild(fragment);
}

function updateModelsTable(counts, total) {
    buildTableWithBars('models-table', counts, total, [
        'var(--chart-color-1)', 'var(--chart-color-2)', 'var(--chart-color-3)',
        'var(--chart-color-4)', 'var(--chart-color-5)'
    ]);
}

function updatePurposesTable(counts, total) {
    buildTableWithBars('purposes-table', counts, total, [
        'var(--chart-color-6)', 'var(--chart-color-7)', 'var(--chart-color-8)',
        'var(--chart-color-9)', 'var(--chart-color-10)'
    ]);
}

function updateProjectsTable(counts, total) {
    buildTableWithBars('projects-table', counts, total, [
        'var(--chart-color-1)', 'var(--chart-color-4)', 'var(--chart-color-3)',
        'var(--chart-color-5)', 'var(--chart-color-2)'
    ]);
}

function updateModelsByProjectTable(modelProjectCounts) {
    const tableBody = document.querySelector('#models-by-project-table tbody');
    const rows = Object.entries(modelProjectCounts)
        .map(([key, count]) => {
            const [projectName, modelName] = key.split('\u0000');
            return { projectName, modelName, count };
        })
        .sort((first, second) =>
            second.count - first.count ||
            first.projectName.localeCompare(second.projectName, 'es') ||
            first.modelName.localeCompare(second.modelName, 'es')
        );

    tableBody.innerHTML = '';
    if (rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="no-data-message">No hay datos disponibles</td></tr>';
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(item => {
        const row = document.createElement('tr');
        [item.projectName, item.modelName, String(item.count)].forEach(value => {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
        });
        fragment.appendChild(row);
    });
    tableBody.appendChild(fragment);
}

function updateTagPairsTable(tagPairCounts) {
    const tableBody = document.querySelector('#tag-pairs-table tbody');
    const rows = Object.entries(tagPairCounts)
        .map(([key, count]) => ({ tags: key.split('\u0000'), count }))
        .sort((first, second) =>
            second.count - first.count ||
            first.tags.join(' + ').localeCompare(second.tags.join(' + '), 'es')
        );

    tableBody.innerHTML = '';
    if (rows.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="2" class="no-data-message">No hay etiquetas que aparezcan juntas</td></tr>';
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(item => {
        const row = document.createElement('tr');
        const tagsCell = document.createElement('td');
        tagsCell.textContent = item.tags.join(' + ');
        const countCell = document.createElement('td');
        countCell.textContent = String(item.count);
        row.appendChild(tagsCell);
        row.appendChild(countCell);
        fragment.appendChild(row);
    });
    tableBody.appendChild(fragment);
}

function updateTimeline(recordsByDate, invalidDateCount = 0) {
    const sortedDates = Object.keys(recordsByDate).sort().reverse();
    const maxCount = Math.max(...Object.values(recordsByDate));
    const timelineContainer = document.getElementById('timeline-container');
    timelineContainer.innerHTML = '';
    if (invalidDateCount) {
        const notice = document.createElement('p');
        notice.className = 'field-guidance';
        notice.textContent = `${invalidDateCount} ${invalidDateCount === 1 ? 'registro sin fecha de creación válida no aparece' : 'registros sin fecha de creación válida no aparecen'} en esta gráfica. Se incluyen en los demás conteos.`;
        timelineContainer.appendChild(notice);
    }

    if (sortedDates.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'no-data-message';
        empty.textContent = 'No hay fechas válidas disponibles';
        timelineContainer.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    sortedDates.forEach(dateKey => {
        const count = recordsByDate[dateKey];
        const percentage = (count / maxCount) * 100;
        const [year, month, day] = dateKey.split('-');
        const formattedDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
            .toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

        const item = document.createElement('div');
        item.className = 'timeline-item';
        item.innerHTML = `
            <div class="timeline-date">
                <span>${formattedDate}</span>
                <span class="timeline-count" title="${count} ${count === 1 ? 'interacción' : 'interacciones'}">${count}</span>
            </div>
            <div class="timeline-bar-container" aria-hidden="true">
                <div class="timeline-bar" style="width:${percentage}%"></div>
            </div>
        `;
        fragment.appendChild(item);
    });
    timelineContainer.appendChild(fragment);
}

function updateTagsCloud(tagCounts) {
    const topTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]).slice(0, 30);
    const tagsCloud = document.getElementById('tags-cloud');
    tagsCloud.innerHTML = '';

    if (topTags.length === 0) {
        tagsCloud.innerHTML = '<div class="no-data-message">No hay etiquetas disponibles</div>';
        return;
    }

    const minCount = Math.min(...topTags.map(t => tagCounts[t]));
    const maxCount = Math.max(...topTags.map(t => tagCounts[t]));
    const colors = [
        'var(--primary-color)',
        'var(--accent-color)',
        'rgba(40, 38, 102, 0.82)',
        'rgba(255, 186, 40, 0.82)',
        'rgba(40, 38, 102, 0.62)'
    ];

    const fragment = document.createDocumentFragment();
    topTags.forEach((tag, index) => {
        const count = tagCounts[tag];
        const fontSize = maxCount === minCount
            ? 14
            : 14 + ((count - minCount) / (maxCount - minCount)) * 14;

        const tagElement = document.createElement('div');
        tagElement.className = 'tag-cloud-item';
        tagElement.textContent = tag;
        tagElement.style.fontSize = `${fontSize}px`;
        tagElement.style.backgroundColor = colors[index % colors.length];
        tagElement.title = `${tag}: ${count} ${count === 1 ? 'ocurrencia' : 'ocurrencias'}`;
        fragment.appendChild(tagElement);
    });
    tagsCloud.appendChild(fragment);
}

Object.assign(ui, { setupStatisticsTab, loadStatistics });

export { setupStatisticsTab, loadStatistics, aggregateStatistics };
