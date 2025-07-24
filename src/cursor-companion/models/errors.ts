/**
 * Error types and handling for Cursor Companion
 */

/**
 * Base error class for Cursor Companion errors
 */
export abstract class CursorCompanionError extends Error {
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;
  
  constructor(message: string, public readonly context?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  TRACKING = 'tracking',
  STORAGE = 'storage',
  ROLLBACK = 'rollback',
  UI = 'ui',
  SNAPSHOT = 'snapshot',
  SYSTEM = 'system',
  DATA_INTEGRITY = 'data_integrity'
}

/**
 * Tracking-related errors
 */
export class TrackingError extends CursorCompanionError {
  readonly code = 'TRACKING_ERROR';
  readonly category = ErrorCategory.TRACKING;
}

/**
 * Storage-related errors
 */
export class StorageError extends CursorCompanionError {
  readonly code = 'STORAGE_ERROR';
  readonly category = ErrorCategory.STORAGE;
}

/**
 * Rollback-related errors
 */
export class RollbackError extends CursorCompanionError {
  readonly code = 'ROLLBACK_ERROR';
  readonly category = ErrorCategory.ROLLBACK;
}

/**
 * UI-related errors
 */
export class UIError extends CursorCompanionError {
  readonly code = 'UI_ERROR';
  readonly category = ErrorCategory.UI;
}

/**
 * Snapshot-related errors
 */
export class SnapshotError extends CursorCompanionError {
  readonly code = 'SNAPSHOT_ERROR';
  readonly category = ErrorCategory.SNAPSHOT;
}

/**
 * System-related errors
 */
export class SystemError extends CursorCompanionError {
  readonly code = 'SYSTEM_ERROR';
  readonly category = ErrorCategory.SYSTEM;
}

/**
 * Data integrity errors
 */
export class DataIntegrityError extends CursorCompanionError {
  readonly code = 'DATA_INTEGRITY_ERROR';
  readonly category = ErrorCategory.DATA_INTEGRITY;
}

/**
 * Error recovery strategy
 */
export interface ErrorRecoveryStrategy {
  /** Whether this error can be automatically recovered from */
  canRecover: boolean;
  
  /** Recovery action to take */
  recoveryAction?: () => Promise<void>;
  
  /** Whether to retry the failed operation */
  shouldRetry: boolean;
  
  /** Maximum number of retries */
  maxRetries?: number;
  
  /** User-friendly message to display */
  userMessage?: string;
}

/**
 * Error handler interface
 */
export interface IErrorHandler {
  /** Handle an error with appropriate recovery strategy */
  handleError(error: CursorCompanionError): Promise<ErrorRecoveryStrategy>;
  
  /** Register a custom error handler for specific error types */
  registerHandler(errorType: string, handler: (error: CursorCompanionError) => Promise<ErrorRecoveryStrategy>): void;
  
  /** Get error statistics */
  getErrorStats(): ErrorStats;
}

/**
 * Error statistics
 */
export interface ErrorStats {
  totalErrors: number;
  errorsByCategory: Record<ErrorCategory, number>;
  recentErrors: Array<{
    error: CursorCompanionError;
    timestamp: number;
    recovered: boolean;
  }>;
}

/**
 * Diagnostic information for troubleshooting
 */
export interface DiagnosticInfo {
  /** Extension version */
  version: string;
  
  /** VSCode version */
  vscodeVersion: string;
  
  /** System information */
  system: {
    platform: string;
    arch: string;
    nodeVersion: string;
  };
  
  /** Extension state */
  state: {
    isTracking: boolean;
    conversationCount: number;
    lastError?: {
      message: string;
      timestamp: number;
      stack?: string;
    };
  };
  
  /** Configuration */
  config: Record<string, any>;
  
  /** Recent activity */
  recentActivity: Array<{
    action: string;
    timestamp: number;
    success: boolean;
  }>;
}