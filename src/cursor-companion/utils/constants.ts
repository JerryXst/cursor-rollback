/**
 * Constants used throughout the Cursor Companion extension
 */

/**
 * Service names for dependency injection
 */
export const SERVICE_NAMES = {
  CONTEXT: 'context',
  DATA_STORAGE: 'dataStorage',
  CONVERSATION_TRACKER: 'conversationTracker',
  ROLLBACK_MANAGER: 'rollbackManager',
  UI_MANAGER: 'uiManager',
  ERROR_HANDLER: 'errorHandler'
} as const;

/**
 * Extension configuration keys
 */
export const CONFIG_KEYS = {
  MAX_CONVERSATIONS: 'cursorCompanion.maxConversations',
  MAX_MESSAGES_PER_CONVERSATION: 'cursorCompanion.maxMessagesPerConversation',
  SNAPSHOT_RETENTION_DAYS: 'cursorCompanion.snapshotRetentionDays',
  MAX_SNAPSHOT_SIZE: 'cursorCompanion.maxSnapshotSize',
  AUTO_TRACK_CONVERSATIONS: 'cursorCompanion.autoTrackConversations',
  EXCLUDE_PATTERNS: 'cursorCompanion.excludePatterns',
  ENABLE_DEBUG_LOGGING: 'cursorCompanion.enableDebugLogging'
} as const;

/**
 * VSCode command IDs
 */
export const COMMANDS = {
  SHOW_CONVERSATIONS: 'cursorCompanion.showConversations',
  REFRESH_CONVERSATIONS: 'cursorCompanion.refreshConversations',
  ROLLBACK_TO_MESSAGE: 'cursorCompanion.rollbackToMessage',
  DELETE_CONVERSATION: 'cursorCompanion.deleteConversation',
  ARCHIVE_CONVERSATION: 'cursorCompanion.archiveConversation',
  SEARCH_CONVERSATIONS: 'cursorCompanion.searchConversations',
  EXPORT_CONVERSATIONS: 'cursorCompanion.exportConversations',
  IMPORT_CONVERSATIONS: 'cursorCompanion.importConversations'
} as const;

/**
 * TreeView IDs
 */
export const TREE_VIEWS = {
  CONVERSATIONS: 'cursorCompanion.conversations'
} as const;

/**
 * File and directory paths
 */
export const PATHS = {
  EXTENSION_DATA: '.vscode/cursor-companion',
  CONVERSATIONS: 'conversations',
  SNAPSHOTS: 'snapshots',
  BACKUPS: 'backups',
  SETTINGS: 'settings.json'
} as const;

/**
 * Event names for internal communication
 */
export const EVENTS = {
  CONVERSATION_CREATED: 'conversationCreated',
  CONVERSATION_UPDATED: 'conversationUpdated',
  CONVERSATION_DELETED: 'conversationDeleted',
  MESSAGE_ADDED: 'messageAdded',
  ROLLBACK_STARTED: 'rollbackStarted',
  ROLLBACK_COMPLETED: 'rollbackCompleted',
  ROLLBACK_FAILED: 'rollbackFailed',
  TRACKING_STARTED: 'trackingStarted',
  TRACKING_STOPPED: 'trackingStopped',
  ERROR_OCCURRED: 'errorOccurred'
} as const;

/**
 * File patterns to exclude by default
 */
export const DEFAULT_EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.log',
  '**/tmp/**',
  '**/temp/**',
  '**/.vscode/**',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml'
];

/**
 * Supported file extensions for code analysis
 */
export const SUPPORTED_EXTENSIONS = [
  '.ts', '.js', '.tsx', '.jsx',
  '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.cs', '.go', '.rs', '.php', '.rb',
  '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.xml', '.yaml', '.yml',
  '.md', '.txt', '.sql'
];

/**
 * Timing constants (in milliseconds)
 */
export const TIMING = {
  DEBOUNCE_DELAY: 300,
  RETRY_DELAY: 1000,
  MAX_RETRY_DELAY: 10000,
  CLEANUP_INTERVAL: 60000, // 1 minute
  SAVE_INTERVAL: 5000, // 5 seconds
  UI_UPDATE_THROTTLE: 100
} as const;

/**
 * Size limits
 */
export const LIMITS = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
  MAX_MESSAGE_LENGTH: 100000, // 100k characters
  MAX_CONVERSATION_TITLE_LENGTH: 100,
  MAX_SEARCH_RESULTS: 100,
  MAX_RECENT_CONVERSATIONS: 50
} as const;

/**
 * Data integrity constants
 */
export const DATA_INTEGRITY = {
  // Validation intervals
  INTEGRITY_CHECK_INTERVAL: 3600000, // 1 hour
  
  // Repair options
  AUTO_REPAIR_MINOR_ISSUES: true,
  CREATE_BACKUP_BEFORE_REPAIR: true,
  
  // Checksum algorithms
  PREFERRED_CHECKSUM_ALGORITHM: 'sha256',
  FALLBACK_CHECKSUM_ALGORITHM: 'simple',
  
  // Error thresholds
  MAX_TOLERABLE_ERRORS: 5,
  CORRUPTION_SEVERITY_THRESHOLD: 3
} as const;