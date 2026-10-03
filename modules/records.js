import { appState } from './runtime.js';

function generateUniqueId(prefix = 'item') {
    if (globalThis.crypto?.randomUUID) {
        return `${prefix}_${globalThis.crypto.randomUUID()}`;
    }

    appState.uniqueIdCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${appState.uniqueIdCounter.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getCurrentLocalDate() {
    const currentDate = new Date();
    const timezoneOffset = currentDate.getTimezoneOffset() * 60000;
    return new Date(currentDate.getTime() - timezoneOffset).toISOString().split('T')[0];
}

function isValidInteractionLink(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
        return false;
    }
}

function getEvidenceType(record) {
    return record.evidenceType === 'local' ? 'local' : 'url';
}

function getEvidenceValue(record) {
    return getEvidenceType(record) === 'local' ? record.evidenceReference : record.interactionLink;
}

function getEvidenceLabel(record) {
    return getEvidenceType(record) === 'local' ? 'Evidencia conservada' : 'Enlace a la conversación';
}

function findProbableDuplicate(records, candidate) {
    const candidateName = normalizeDuplicateValue(candidate.interactionName);
    const candidatePrompt = normalizeDuplicateValue(candidate.prompt);
    const candidateLink = normalizeDuplicateValue(getEvidenceValue(candidate));

    return records.find(record => {
        if (record.id === candidate.id) return false;
        const sameLink = candidateLink && getEvidenceType(record) === getEvidenceType(candidate) &&
            normalizeDuplicateValue(getEvidenceValue(record)) === candidateLink;
        const sameNameAndPrompt = candidateName && candidatePrompt &&
            normalizeDuplicateValue(record.interactionName) === candidateName &&
            normalizeDuplicateValue(record.prompt) === candidatePrompt;
        return sameLink || sameNameAndPrompt;
    });
}

const recordQualityCache = new WeakMap();

function qualityRulesSignature() {
    const rules = appState.qualityRules;
    return Number(Boolean(rules.requireDate)) + Number(Boolean(rules.requireProvider)) * 2 +
        Number(Boolean(rules.requireStage)) * 4 + Number(Boolean(rules.requireVerification)) * 8 +
        Number(Boolean(rules.requireProject)) * 16;
}

function evaluateRecordQuality(record) {
    const signature = qualityRulesSignature();
    const cached = recordQualityCache.get(record);
    if (cached?.signature === signature) return cached.result;
    const result = computeRecordQuality(record);
    recordQualityCache.set(record, {signature, result});
    return result;
}

function computeRecordQuality(record) {
    const requiredFields = [
        ['nombre de la interacción', record.interactionName],
        ['finalidad', record.purpose],
        ['modelo', record.llmName],
        ['prompt', record.prompt],
        [getEvidenceType(record) === 'local' ? 'referencia de evidencia' : 'liga de interacción', getEvidenceValue(record)]
    ];
    const recommendedFields = [];
    if (appState.qualityRules.requireDate) recommendedFields.push(['fecha de interacción', record.interactionDate]);
    if (appState.qualityRules.requireProvider) recommendedFields.push(['empresa proveedora', record.providerCompany]);
    if (appState.qualityRules.requireStage) recommendedFields.push(['etapa del trabajo', record.ethicalNotes]);
    if (appState.qualityRules.requireVerification) {
        recommendedFields.push(['verificación humana y responsabilidad', record.biasNotes]);
    }

    const missingValues = new Set(['sin nombre', 'sin especificar', 'importado desde csv']);
    const isMissingValue = value => {
        const normalized = String(value || '').trim().toLowerCase();
        return !normalized || missingValues.has(normalized);
    };

    const missingRequired = requiredFields
        .filter(([, value]) => isMissingValue(value))
        .map(([label]) => `falta ${label}`);
    if (
        getEvidenceType(record) === 'url' && !isMissingValue(record.interactionLink) &&
        !isValidInteractionLink(record.interactionLink)
    ) {
        missingRequired.push('liga de interacción no válida');
    }
    if (missingRequired.length > 0) {
        return { status: 'incomplete', label: 'Incompleto', issues: missingRequired };
    }

    const warnings = recommendedFields
        .filter(([, value]) => !String(value || '').trim())
        .map(([label]) => `falta ${label}`);
    if (appState.qualityRules.requireProject && !record.projectId) warnings.push('sin proyecto');

    if (warnings.length > 0) {
        return { status: 'warning', label: 'Con advertencias', issues: warnings };
    }

    return { status: 'ready', label: 'Listo para declaración', issues: [] };
}

function normalizeDuplicateValue(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildDuplicateRecordMap(records) {
    const groups = new Map();

    records.forEach(record => {
        const interactionName = normalizeDuplicateValue(record.interactionName);
        const prompt = normalizeDuplicateValue(record.prompt);
        const evidence = normalizeDuplicateValue(getEvidenceValue(record));
        const interactionLink = evidence ? `${getEvidenceType(record)}:${evidence}` : '';
        if (!interactionName || (!prompt && !interactionLink)) return;

        const signature = [
            normalizeDuplicateValue(record.projectId),
            interactionName,
            normalizeDuplicateValue(record.purpose),
            normalizeDuplicateValue(record.interactionDate),
            normalizeDuplicateValue(record.providerCompany),
            normalizeDuplicateValue(record.llmName),
            normalizeDuplicateValue(record.llmVersion),
            prompt,
            interactionLink
        ].join('|');

        if (!groups.has(signature)) groups.set(signature, []);
        groups.get(signature).push(record.id);
    });

    const duplicates = new Map();
    groups.forEach(recordIds => {
        if (recordIds.length < 2) return;
        recordIds.forEach(recordId => duplicates.set(recordId, recordIds.length));
    });
    return duplicates;
}

function buildImportReport(format, importedRecords, finalRecords, importedProjectCount = 0, skippedRecordCount = 0, skippedProjectCount = 0) {
    const qualityCounts = { incomplete: 0, warning: 0, ready: 0 };
    importedRecords.forEach(record => {
        qualityCounts[evaluateRecordQuality(record).status] += 1;
    });

    const importedIds = new Set(importedRecords.map(record => record.id));
    const duplicateRecords = buildDuplicateRecordMap(finalRecords);
    const importedDuplicates = Array.from(duplicateRecords.keys())
        .filter(recordId => importedIds.has(recordId))
        .length;
    const reviewCount = qualityCounts.incomplete + qualityCounts.warning;

    const lines = [
        `Importación ${format} completada.`,
        `Registros importados: ${importedRecords.length}.`,
        `Proyectos incorporados: ${importedProjectCount}.`
    ];
    if (skippedRecordCount > 0) lines.push(`Registros omitidos por ID existente: ${skippedRecordCount}.`);
    if (skippedProjectCount > 0) lines.push(`Proyectos omitidos por ID existente: ${skippedProjectCount}.`);
    lines.push(`Registros incompletos: ${qualityCounts.incomplete}.`);
    lines.push(`Registros con advertencias: ${qualityCounts.warning}.`);
    lines.push(`Posibles duplicados importados: ${importedDuplicates}.`);
    if (reviewCount > 0 || importedDuplicates > 0) {
        lines.push('Revisa estos casos en Herramientas > Revisión de registros.');
    }
    return lines.join('\n');
}

function getChatLogVersion() {
    return chrome.runtime?.getManifest?.().version || '2.0.1';
}

function isValidStoredDate(value) {
    if (typeof value !== 'string' || !value.trim() || !Number.isFinite(new Date(value).getTime())) return false;
    const datePart = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (!datePart) return true;
    const parsed = new Date(`${datePart}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === datePart;
}

// Se examina la colección una vez y se conservan como máximo diez candidatos.
function selectRecentRecords(records, projectFilter = null, limit = 10) {
    const recent = [];
    for (const record of records) {
        if (projectFilter && projectFilter !== 'all' &&
            (projectFilter === 'none' ? Boolean(record.projectId) : record.projectId !== projectFilter)) continue;
        const entry = {record, important: Number(Boolean(record.isImportant)),
            modified: Date.parse(record.dateModified) || 0};
        let index = 0;
        while (index < recent.length && (recent[index].important > entry.important ||
            (recent[index].important === entry.important && recent[index].modified >= entry.modified))) index++;
        if (index < limit) {
            recent.splice(index, 0, entry);
            if (recent.length > limit) recent.pop();
        }
    }
    return recent.map(entry => entry.record);
}

export { generateUniqueId, getCurrentLocalDate, isValidInteractionLink, getEvidenceType, getEvidenceValue, getEvidenceLabel, findProbableDuplicate, evaluateRecordQuality, normalizeDuplicateValue, buildDuplicateRecordMap, buildImportReport, getChatLogVersion, isValidStoredDate, qualityRulesSignature, selectRecentRecords };
