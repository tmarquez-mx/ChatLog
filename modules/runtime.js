export const REMINDER_SETTINGS_KEY = 'chatlog_backup_reminder_settings';
export const REMINDER_STATE_KEY = 'chatlog_backup_reminder_state';
export const QUALITY_RULES_KEY = 'chatlog_quality_rules';
export const ONBOARDING_STATE_KEY = 'chatlog_onboarding_state';
export const GUIDED_FLOW_STATE_KEY = 'chatlog_guided_flow_state';
export const ACTIVE_RECORD_DRAFT_KEY = 'chatlog_active_record_draft';
export const PROVIDER_MODEL_CATALOG = [
    { provider: 'Anthropic', model: 'Claude' },
    { provider: 'OpenAI', model: 'ChatGPT' },
    { provider: 'Google (DeepMind)', model: 'Gemini', providerAliases: ['Google', 'Google DeepMind'] },
    { provider: 'Meta', model: 'Llama' },
    { provider: 'DeepSeek', model: 'DeepSeek' },
    { provider: 'Alibaba', model: 'Qwen' }
];
export const RECORD_FORM_FIELDS = ['record-id', 'interaction-name', 'purpose', 'other-purpose',
    'interaction-date', 'provider-company', 'llm-name', 'llm-version', 'prompt',
    'interaction-link', 'evidence-type', 'evidence-reference', 'ethical-notes', 'bias-notes', 'observations', 'rating-value', 'tags-input'];
export const DEFAULT_QUALITY_RULES = {
    requireDate: true,
    requireProvider: true,
    requireStage: true,
    requireVerification: true,
    requireProject: true
};
export const appState = {
    allTags: [],
    currentTags: [],
    selectedRecords: [],
    recoverySaveQueue: Promise.resolve(true),
    recordFormIsNew: true,
    storageCache: new Map(),
    pendingStorageLoads: new Map(),
    initializedTabs: new Set(),
    storageRevision: 0,
    statisticsDataCache: null,
    qualityRules: { ...DEFAULT_QUALITY_RULES },
    qualityRulesLoaded: false,
    onboardingCurrentStep: 0,
    onboardingPreviousFocus: null,
    recordFormDirty: false,
    appStatusTimer: null,
    backupChangeQueue: Promise.resolve(),
    recordAutosaveTimer: null,
    recordAutosaveQueue: Promise.resolve(),
    recordFormChangeVersion: 0,
    recordAutosaveInProgress: false,
    appDialogResolver: null,
    appDialogPreviousFocus: null,
    uniqueIdCounter: 0,
    managementSelectedRecords: new Set(),
    managementVisibleRecordIds: [],
};

// Callbacks de interfaz; las vistas secundarias se registran al cargarse.
export const ui = {
    loadProjectsForManagement: async () => {},
    loadRecordsForManagement: async () => {},
    loadDeclarationProjects: async () => {},
    loadRecordsForDeclaration: async () => {},
    loadStatistics: async () => {},
};
