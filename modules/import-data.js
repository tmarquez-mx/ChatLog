import { generateUniqueId, isValidStoredDate } from './records.js';

function sanitizeFilenamePart(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase() || 'datos';
}

function escapeCsvValue(value) {
    if (value === null || value === undefined) return '""';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function normalizeImportedEvidence(record) {
    const reference = String(record.evidenceReference || record['Referencia de evidencia'] || '').trim();
    const type = String(record.evidenceType || record['Tipo de evidencia'] || '').trim().toLowerCase();
    return {
        evidenceType: type === 'local' || (!type && reference) ? 'local' : 'url',
        evidenceReference: reference
    };
}

function validateImportedRecords(records) {
    records.forEach((record, index) => {
        for (const field of ['id', 'interactionName', 'purpose', 'llmName', 'llmVersion', 'prompt',
            'interactionLink', 'evidenceReference', 'providerCompany', 'ethicalNotes', 'biasNotes', 'observations']) {
            if (typeof record[field] !== 'string') throw new Error(`El registro ${index + 1} contiene un valor inválido en ${field}.`);
        }
        for (const field of ['dateCreated', 'dateModified', 'interactionDate']) {
            if (record[field] && !isValidStoredDate(record[field])) {
                throw new Error(`El registro ${index + 1} (${record.interactionName}) contiene una fecha inválida en ${field}. Corrígela en el archivo antes de importar.`);
            }
        }
        if (!Array.isArray(record.tags) || record.tags.some(tag => typeof tag !== 'string')) {
            throw new Error(`El registro ${index + 1} contiene etiquetas inválidas.`);
        }
    });
}

function validateImportedProjects(projects) {
    projects.forEach(project => {
        if (project.dateCreated && !isValidStoredDate(project.dateCreated)) {
            throw new Error(`El proyecto ${project.name} contiene una fecha de creación inválida.`);
        }
    });
}

function normalizeImportedJsonRecords(records) {
    return records.map(record => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
            throw new Error('El respaldo contiene un registro que no es un objeto válido.');
        }
        if (record && Object.prototype.hasOwnProperty.call(record, 'interactionName')) {
            return {
                ...record,
                id: String(record.id || generateUniqueId('record')),
                interactionName: record.interactionName || 'Sin nombre',
                purpose: record.purpose || 'Sin especificar',
                interactionDate: record.interactionDate || '',
                providerCompany: record.providerCompany || '',
                llmName: record.llmName || 'Sin especificar',
                llmVersion: record.llmVersion || '',
                prompt: record.prompt || '',
                interactionLink: record.interactionLink || '',
                ...normalizeImportedEvidence(record),
                tags: Array.isArray(record.tags) ? record.tags : [],
                ethicalNotes: record.ethicalNotes || '',
                biasNotes: record.biasNotes || '',
                observations: record.observations || '',
                rating: record.rating || '0',
                isImportant: Boolean(record.isImportant),
                projectId: record.projectId || null,
                dateCreated: record.dateCreated || new Date().toISOString(),
                dateModified: record.dateModified || new Date().toISOString()
            };
        }

        return {
            id: String(record.id || generateUniqueId('record')),
            interactionName: record['Nombre de la interacción'] || 'Sin nombre',
            purpose: record['Finalidad'] || record['Propósito'] || record['Proposito'] || 'Sin especificar',
            interactionDate: record['Fecha de interacción'] || '',
            providerCompany: record['Empresa proveedora'] || '',
            llmName: record['Modelo y versión'] || record['Modelo'] || 'Sin especificar',
            llmVersion: '',
            prompt: record['Prompt'] || '',
            interactionLink: record['Liga a la interacción'] || '',
            ...normalizeImportedEvidence(record),
            tags: Array.isArray(record['Etiquetas'])
                ? record['Etiquetas']
                : String(record['Etiquetas'] || '').split(/[,;]/).map(tag => tag.trim()).filter(Boolean),
            ethicalNotes: record['Etapa del trabajo'] || record['Aspectos éticos'] || '',
            biasNotes: record['Verificación humana y responsabilidad'] || record['Notas sobre mitigación'] || '',
            observations: record['Observaciones'] || '',
            rating: record['Calificación'] || '0',
            isImportant: parseImportedBoolean(record['Importante']),
            projectId: record.projectId || record['ID del proyecto'] || null,
            dateCreated: record.dateCreated || new Date().toISOString(),
            dateModified: record.dateModified || new Date().toISOString()
        };
    });
}

function parseImportedBoolean(value) {
    return ['sí', 'si', 'true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

function normalizeProjectName(name) {
    return String(name || '').trim().toLocaleLowerCase('es-MX');
}

function reconcileImportedProjects(importedProjects, existingProjects, importMode) {
    const projects = importMode === 'merge' ? [...existingProjects] : [];
    const projectsById = new Map(projects.map(project => [String(project.id), project]));
    const projectsByName = new Map(
        projects.map(project => [normalizeProjectName(project.name), project])
    );
    const projectIdMap = new Map();
    let importedCount = 0;
    let skippedCount = 0;

    importedProjects.forEach(project => {
        if (!project || typeof project !== 'object') {
            skippedCount += 1;
            return;
        }

        const sourceProjectId = String(project.id || '').trim();
        const projectName = String(project.name || '').trim();
        if (!projectName) {
            skippedCount += 1;
            return;
        }

        const existingProject = (
            (sourceProjectId && projectsById.get(sourceProjectId)) ||
            projectsByName.get(normalizeProjectName(projectName))
        );

        if (existingProject) {
            if (sourceProjectId) projectIdMap.set(sourceProjectId, existingProject.id);
            skippedCount += 1;
            return;
        }

        const projectId = sourceProjectId || generateUniqueId('project');
        const normalizedProject = {
            ...project,
            id: projectId,
            name: projectName,
            dateCreated: project.dateCreated || new Date().toISOString()
        };

        projects.push(normalizedProject);
        projectsById.set(projectId, normalizedProject);
        projectsByName.set(normalizeProjectName(projectName), normalizedProject);
        if (sourceProjectId) projectIdMap.set(sourceProjectId, projectId);
        importedCount += 1;
    });

    return { projects, projectIdMap, importedCount, skippedCount };
}

function parseCSV(csvContent) {
    if (csvContent.charCodeAt(0) === 0xFEFF) csvContent = csvContent.slice(1);

    const rows = [];
    let row = [];
    let value = '';
    let inQuotes = false;
    let quotedValue = false;

    const pushValue = () => {
        row.push(quotedValue ? value : value.trim());
        value = '';
        quotedValue = false;
    };
    const pushRow = () => {
        pushValue();
        if (row.some(cell => cell !== '')) rows.push(row);
        row = [];
    };

    for (let index = 0; index < csvContent.length; index += 1) {
        const char = csvContent[index];

        if (inQuotes) {
            if (char === '"' && csvContent[index + 1] === '"') {
                value += '"';
                index += 1;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                value += char;
            }
            continue;
        }

        if (char === '"' && value === '') {
            inQuotes = true;
            quotedValue = true;
        } else if (char === ',') {
            pushValue();
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && csvContent[index + 1] === '\n') index += 1;
            pushRow();
        } else {
            value += char;
        }
    }

    if (inQuotes) {
        throw new Error('El archivo CSV contiene un campo entre comillas sin cerrar.');
    }
    if (value !== '' || row.length > 0) pushRow();
    if (rows.length <= 1) return [];

    const headers = rows[0].map(header => header.trim());
    return rows.slice(1).map(values => {
        const record = Object.create(null);
        headers.forEach((header, index) => {
            record[header] = index < values.length ? values[index] : '';
        });
        return record;
    });
}

export { sanitizeFilenamePart, escapeCsvValue, normalizeImportedEvidence, validateImportedRecords, validateImportedProjects, normalizeImportedJsonRecords, parseImportedBoolean, normalizeProjectName, reconcileImportedProjects, parseCSV };
