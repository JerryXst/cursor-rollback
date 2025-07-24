import * as vscode from 'vscode';
import { StorageError, SnapshotError, DataIntegrityError } from '../models/errors';
import { ValidationError } from '../models/validation';

/**
 * Centralized error handling and recovery system
 */
export class ErrorHandler {
  private static instance: ErrorHandler;
  private readonly errorLog: ErrorLogEntry[] = [];
  private readonly maxLogSize = 1000;
  private readonly recoveryStrategies: Map<string, RecoveryStrategy> = new Map();

  private constructor(private context: vscode.ExtensionContext) {
    this.initializeRecoveryStrategies();
    this.loadErrorLog();
  }

  public static getInstance(context: vscode.ExtensionContext): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler(context);
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle an error with automatic recovery attempts
   */
  async handleError(error: Error, context: ErrorContext): Promise<ErrorHandlingResult> {
    const errorEntry = this.createErrorLogEntry(error, context);
    this.addToErrorLog(errorEntry);

    // Categorize the error
    const category = this.categorizeError(error);
    
    // Get recovery strategy
    const strategy = this.recoveryStrategies.get(category);
    
    let recoveryResult: RecoveryResult = { success: false };
    
    if (strategy) {
      try {
        recoveryResult = await strategy.recover(error, context);
      } catch (recoveryError) {
        console.error(`Recovery strategy failed for ${category}:`, recoveryError);
      }
    }

    // Show user notification based on severity
    await this.notifyUser(error, context, recoveryResult);

    // Save error log
    await this.saveErrorLog();

    return {
      handled: true,
      recovered: recoveryResult.success,
      userNotified: true,
      logEntry: errorEntry
    };
  }

  /**
   * Handle errors with different severity levels
   */
  async handleErrorWithSeverity(
    error: Error, 
    severity: ErrorSeverity, 
    context: ErrorContext
  ): Promise<ErrorHandlingResult> {
    const result = await this.handleError(error, { ...context, severity });
    
    // For critical errors, offer additional recovery options
    if (severity === ErrorSeverity.CRITICAL && !result.recovered) {
      await this.handleCriticalError(error, context);
    }
    
    return result;
  }

  /**
   * Register a custom recovery strategy
   */
  registerRecoveryStrategy(errorType: string, strategy: RecoveryStrategy): void {
    this.recoveryStrategies.set(errorType, strategy);
  }

  /**
   * Get error statistics
   */
  getErrorStatistics(): ErrorStatistics {
    const now = Date.now();
    const last24Hours = this.errorLog.filter(entry => now - entry.timestamp < 24 * 60 * 60 * 1000);
    const lastWeek = this.errorLog.filter(entry => now - entry.timestamp < 7 * 24 * 60 * 60 * 1000);

    const categoryCounts = new Map<string, number>();
    this.errorLog.forEach(entry => {
      const count = categoryCounts.get(entry.category) || 0;
      categoryCounts.set(entry.category, count + 1);
    });

    return {
      totalErrors: this.errorLog.length,
      errorsLast24Hours: last24Hours.length,
      errorsLastWeek: lastWeek.length,
      errorsByCategory: Object.fromEntries(categoryCounts),
      mostCommonError: this.getMostCommonError(),
      recoverySuccessRate: this.calculateRecoverySuccessRate()
    };
  }

  /**
   * Export error log for debugging
   */
  async exportErrorLog(): Promise<string> {
    const logData = {
      exportDate: new Date().toISOString(),
      totalEntries: this.errorLog.length,
      errors: this.errorLog.map(entry => ({
        ...entry,
        timestamp: new Date(entry.timestamp).toISOString()
      }))
    };

    return JSON.stringify(logData, null, 2);
  }

  /**
   * Clear error log
   */
  async clearErrorLog(): Promise<void> {
    this.errorLog.length = 0;
    await this.saveErrorLog();
  }

  private initializeRecoveryStrategies(): void {
    // Storage error recovery
    this.recoveryStrategies.set('storage', {
      recover: async (error: Error, context: ErrorContext) => {
        if (error instanceof StorageError) {
          // Try to recreate storage directory
          try {
            const storageUri = this.context.globalStorageUri;
            await vscode.workspace.fs.createDirectory(storageUri);
            return { success: true, message: 'Storage directory recreated' };
          } catch (recreateError) {
            return { success: false, message: 'Failed to recreate storage directory' };
          }
        }
        return { success: false, message: 'Not a storage error' };
      }
    });

    // Validation error recovery
    this.recoveryStrategies.set('validation', {
      recover: async (error: Error, context: ErrorContext) => {
        if (error instanceof ValidationError) {
          // Try to repair the data
          if (context.data) {
            try {
              const repairedData = this.repairData(context.data, error);
              return { 
                success: true, 
                message: 'Data repaired automatically',
                repairedData 
              };
            } catch (repairError) {
              return { success: false, message: 'Failed to repair data' };
            }
          }
        }
        return { success: false, message: 'Not a validation error' };
      }
    });

    // Snapshot error recovery
    this.recoveryStrategies.set('snapshot', {
      recover: async (error: Error, context: ErrorContext) => {
        if (error instanceof SnapshotError) {
          // Try to recreate snapshot
          try {
            // This would require access to snapshot manager
            return { success: false, message: 'Snapshot recreation not implemented' };
          } catch (snapshotError) {
            return { success: false, message: 'Failed to recreate snapshot' };
          }
        }
        return { success: false, message: 'Not a snapshot error' };
      }
    });

    // Data integrity error recovery
    this.recoveryStrategies.set('integrity', {
      recover: async (error: Error, context: ErrorContext) => {
        if (error instanceof DataIntegrityError) {
          // Try to repair data integrity
          try {
            // This would require access to data integrity utilities
            return { success: false, message: 'Data integrity repair not implemented' };
          } catch (integrityError) {
            return { success: false, message: 'Failed to repair data integrity' };
          }
        }
        return { success: false, message: 'Not a data integrity error' };
      }
    });

    // Generic file system error recovery
    this.recoveryStrategies.set('filesystem', {
      recover: async (error: Error, context: ErrorContext) => {
        const message = error.message.toLowerCase();
        
        if (message.includes('enoent') || message.includes('no such file')) {
          // Try to create missing directories
          if (context.filePath) {
            try {
              const dirPath = context.filePath.substring(0, context.filePath.lastIndexOf('/'));
              await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirPath));
              return { success: true, message: 'Missing directory created' };
            } catch (createError) {
              return { success: false, message: 'Failed to create missing directory' };
            }
          }
        }
        
        if (message.includes('permission') || message.includes('eacces')) {
          return { 
            success: false, 
            message: 'Permission error - manual intervention required',
            requiresUserAction: true
          };
        }
        
        return { success: false, message: 'Unknown filesystem error' };
      }
    });
  }

  private categorizeError(error: Error): string {
    if (error instanceof StorageError) return 'storage';
    if (error instanceof ValidationError) return 'validation';
    if (error instanceof SnapshotError) return 'snapshot';
    if (error instanceof DataIntegrityError) return 'integrity';
    
    const message = error.message.toLowerCase();
    if (message.includes('enoent') || message.includes('eacces') || message.includes('permission')) {
      return 'filesystem';
    }
    if (message.includes('network') || message.includes('timeout')) {
      return 'network';
    }
    if (message.includes('parse') || message.includes('json') || message.includes('syntax')) {
      return 'parsing';
    }
    
    return 'unknown';
  }

  private createErrorLogEntry(error: Error, context: ErrorContext): ErrorLogEntry {
    return {
      id: this.generateErrorId(),
      timestamp: Date.now(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      category: this.categorizeError(error),
      context,
      severity: context.severity || ErrorSeverity.ERROR,
      recovered: false
    };
  }

  private addToErrorLog(entry: ErrorLogEntry): void {
    this.errorLog.push(entry);
    
    // Keep log size manageable
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog.splice(0, this.errorLog.length - this.maxLogSize);
    }
  }

  private async notifyUser(
    error: Error, 
    context: ErrorContext, 
    recoveryResult: RecoveryResult
  ): Promise<void> {
    const severity = context.severity || ErrorSeverity.ERROR;
    
    let message = this.formatUserMessage(error, context, recoveryResult);
    
    switch (severity) {
      case ErrorSeverity.INFO:
        vscode.window.showInformationMessage(message);
        break;
        
      case ErrorSeverity.WARNING:
        const warningAction = await vscode.window.showWarningMessage(
          message, 
          'View Details', 
          'Dismiss'
        );
        if (warningAction === 'View Details') {
          await this.showErrorDetails(error, context);
        }
        break;
        
      case ErrorSeverity.ERROR:
        const errorAction = await vscode.window.showErrorMessage(
          message,
          'View Details',
          'Report Issue',
          'Dismiss'
        );
        await this.handleErrorAction(errorAction, error, context);
        break;
        
      case ErrorSeverity.CRITICAL:
        const criticalAction = await vscode.window.showErrorMessage(
          message,
          { modal: true },
          'View Details',
          'Reset Extension',
          'Report Issue'
        );
        await this.handleCriticalErrorAction(criticalAction, error, context);
        break;
    }
  }

  private async handleCriticalError(error: Error, context: ErrorContext): Promise<void> {
    // For critical errors, offer extension reset
    const action = await vscode.window.showErrorMessage(
      'A critical error occurred that may require resetting the extension state.',
      { modal: true },
      'Reset Extension State',
      'Continue Anyway',
      'Report Issue'
    );

    switch (action) {
      case 'Reset Extension State':
        await this.resetExtensionState();
        break;
      case 'Report Issue':
        await this.reportIssue(error, context);
        break;
    }
  }

  private formatUserMessage(
    error: Error, 
    context: ErrorContext, 
    recoveryResult: RecoveryResult
  ): string {
    let message = `${context.operation || 'Operation'} failed: ${error.message}`;
    
    if (recoveryResult.success) {
      message += `\n\nRecovery: ${recoveryResult.message}`;
    } else if (recoveryResult.message) {
      message += `\n\nRecovery failed: ${recoveryResult.message}`;
    }
    
    return message;
  }

  private async showErrorDetails(error: Error, context: ErrorContext): Promise<void> {
    const details = [
      `Error Details`,
      `=============`,
      ``,
      `Name: ${error.name}`,
      `Message: ${error.message}`,
      `Operation: ${context.operation || 'Unknown'}`,
      `Component: ${context.component || 'Unknown'}`,
      `Timestamp: ${new Date().toLocaleString()}`,
      ``,
      `Stack Trace:`,
      error.stack || 'No stack trace available',
      ``,
      `Context:`,
      JSON.stringify(context, null, 2)
    ].join('\n');

    const document = await vscode.workspace.openTextDocument({
      content: details,
      language: 'plaintext'
    });

    await vscode.window.showTextDocument(document);
  }

  private async handleErrorAction(
    action: string | undefined, 
    error: Error, 
    context: ErrorContext
  ): Promise<void> {
    switch (action) {
      case 'View Details':
        await this.showErrorDetails(error, context);
        break;
      case 'Report Issue':
        await this.reportIssue(error, context);
        break;
    }
  }

  private async handleCriticalErrorAction(
    action: string | undefined,
    error: Error,
    context: ErrorContext
  ): Promise<void> {
    switch (action) {
      case 'View Details':
        await this.showErrorDetails(error, context);
        break;
      case 'Reset Extension':
        await this.resetExtensionState();
        break;
      case 'Report Issue':
        await this.reportIssue(error, context);
        break;
    }
  }

  private async reportIssue(error: Error, context: ErrorContext): Promise<void> {
    const issueBody = this.generateIssueReport(error, context);
    const issueUrl = `https://github.com/your-repo/cursor-companion/issues/new?body=${encodeURIComponent(issueBody)}`;
    
    await vscode.env.openExternal(vscode.Uri.parse(issueUrl));
  }

  private generateIssueReport(error: Error, context: ErrorContext): string {
    const stats = this.getErrorStatistics();
    
    return [
      `## Error Report`,
      ``,
      `**Error:** ${error.name}: ${error.message}`,
      `**Operation:** ${context.operation || 'Unknown'}`,
      `**Component:** ${context.component || 'Unknown'}`,
      `**Timestamp:** ${new Date().toISOString()}`,
      ``,
      `### Error Statistics`,
      `- Total errors: ${stats.totalErrors}`,
      `- Errors in last 24h: ${stats.errorsLast24Hours}`,
      `- Recovery success rate: ${stats.recoverySuccessRate}%`,
      ``,
      `### Stack Trace`,
      `\`\`\``,
      error.stack || 'No stack trace available',
      `\`\`\``,
      ``,
      `### Context`,
      `\`\`\`json`,
      JSON.stringify(context, null, 2),
      `\`\`\``
    ].join('\n');
  }

  private async resetExtensionState(): Promise<void> {
    try {
      // Clear all stored state
      const keys = this.context.globalState.keys();
      for (const key of keys) {
        await this.context.globalState.update(key, undefined);
      }
      
      // Clear workspace state
      const workspaceKeys = this.context.workspaceState.keys();
      for (const key of workspaceKeys) {
        await this.context.workspaceState.update(key, undefined);
      }
      
      // Clear error log
      await this.clearErrorLog();
      
      vscode.window.showInformationMessage(
        'Extension state has been reset. Please reload the window.',
        'Reload Window'
      ).then(action => {
        if (action === 'Reload Window') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      });
    } catch (resetError) {
      vscode.window.showErrorMessage(`Failed to reset extension state: ${resetError}`);
    }
  }

  private repairData(data: any, error: ValidationError): any {
    // Basic data repair logic - this would be expanded based on specific error types
    if (error.field === 'timestamp' && typeof data.timestamp !== 'number') {
      data.timestamp = Date.now();
    }
    
    if (error.field === 'id' && !data.id) {
      data.id = this.generateErrorId();
    }
    
    return data;
  }

  private generateErrorId(): string {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getMostCommonError(): string {
    const categoryCounts = new Map<string, number>();
    this.errorLog.forEach(entry => {
      const count = categoryCounts.get(entry.category) || 0;
      categoryCounts.set(entry.category, count + 1);
    });

    let mostCommon = '';
    let maxCount = 0;
    categoryCounts.forEach((count, category) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = category;
      }
    });

    return mostCommon;
  }

  private calculateRecoverySuccessRate(): number {
    if (this.errorLog.length === 0) return 0;
    
    const recoveredCount = this.errorLog.filter(entry => entry.recovered).length;
    return Math.round((recoveredCount / this.errorLog.length) * 100);
  }

  private async loadErrorLog(): Promise<void> {
    try {
      const logData = this.context.globalState.get<ErrorLogEntry[]>('errorLog', []);
      this.errorLog.push(...logData);
    } catch (error) {
      console.warn('Failed to load error log:', error);
    }
  }

  private async saveErrorLog(): Promise<void> {
    try {
      await this.context.globalState.update('errorLog', this.errorLog);
    } catch (error) {
      console.warn('Failed to save error log:', error);
    }
  }
}

// Types and interfaces

export enum ErrorSeverity {
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical'
}

export interface ErrorContext {
  operation?: string;
  component?: string;
  filePath?: string;
  data?: any;
  severity?: ErrorSeverity;
  userId?: string;
  sessionId?: string;
}

export interface ErrorHandlingResult {
  handled: boolean;
  recovered: boolean;
  userNotified: boolean;
  logEntry: ErrorLogEntry;
}

export interface ErrorLogEntry {
  id: string;
  timestamp: number;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  category: string;
  context: ErrorContext;
  severity: ErrorSeverity;
  recovered: boolean;
}

export interface RecoveryStrategy {
  recover(error: Error, context: ErrorContext): Promise<RecoveryResult>;
}

export interface RecoveryResult {
  success: boolean;
  message?: string;
  repairedData?: any;
  requiresUserAction?: boolean;
}

export interface ErrorStatistics {
  totalErrors: number;
  errorsLast24Hours: number;
  errorsLastWeek: number;
  errorsByCategory: { [category: string]: number };
  mostCommonError: string;
  recoverySuccessRate: number;
}