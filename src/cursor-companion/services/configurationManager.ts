import * as vscode from 'vscode';

/**
 * Manages user settings and preferences for Cursor Companion
 */
export class ConfigurationManager {
  private static instance: ConfigurationManager;
  private readonly configSection = 'cursor-companion';
  private configChangeListeners: Array<(config: CursorCompanionConfig) => void> = [];

  private constructor(private context: vscode.ExtensionContext) {
    this.setupConfigurationWatcher();
  }

  public static getInstance(context: vscode.ExtensionContext): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager(context);
    }
    return ConfigurationManager.instance;
  }

  /**
   * Get the current configuration
   */
  getConfiguration(): CursorCompanionConfig {
    const config = vscode.workspace.getConfiguration(this.configSection);
    
    return {
      autoTrack: config.get('autoTrack', true),
      maxConversations: config.get('maxConversations', 1000),
      snapshotRetention: config.get('snapshotRetention', 30),
      enableDiagnostics: config.get('enableDiagnostics', true),
      autoBackup: config.get('autoBackup', true),
      maxBackups: config.get('maxBackups', 10),
      showRollbackConfirmation: config.get('showRollbackConfirmation', true),
      enableErrorRecovery: config.get('enableErrorRecovery', true),
      logLevel: config.get('logLevel', 'info') as LogLevel,
      performanceMonitoring: config.get('performanceMonitoring', true),
      showActivationMessage: config.get('showActivationMessage', true),
      trackingMode: config.get('trackingMode', 'automatic') as TrackingMode,
      uiTheme: config.get('uiTheme', 'auto') as UITheme,
      searchSettings: {
        caseSensitive: config.get('search.caseSensitive', false),
        useRegex: config.get('search.useRegex', false),
        maxResults: config.get('search.maxResults', 100),
        highlightMatches: config.get('search.highlightMatches', true)
      },
      rollbackSettings: {
        createBackupByDefault: config.get('rollback.createBackupByDefault', true),
        resetContextByDefault: config.get('rollback.resetContextByDefault', false),
        showProgressDialog: config.get('rollback.showProgressDialog', true),
        maxRollbackHistory: config.get('rollback.maxRollbackHistory', 50)
      },
      storageSettings: {
        compressionEnabled: config.get('storage.compressionEnabled', true),
        encryptionEnabled: config.get('storage.encryptionEnabled', false),
        cleanupInterval: config.get('storage.cleanupInterval', 24),
        maxStorageSize: config.get('storage.maxStorageSize', 1024)
      }
    };
  }

  /**
   * Update a configuration value
   */
  async updateConfiguration<K extends keyof CursorCompanionConfig>(
    key: K,
    value: CursorCompanionConfig[K],
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.configSection);
    await config.update(key, value, target);
  }

  /**
   * Update nested configuration value
   */
  async updateNestedConfiguration(
    path: string,
    value: any,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.configSection);
    await config.update(path, value, target);
  }

  /**
   * Reset configuration to defaults
   */
  async resetConfiguration(): Promise<void> {
    const config = vscode.workspace.getConfiguration(this.configSection);
    const inspect = config.inspect('');
    
    if (inspect) {
      // Reset all configuration keys
      const keys = [
        'autoTrack', 'maxConversations', 'snapshotRetention', 'enableDiagnostics',
        'autoBackup', 'maxBackups', 'showRollbackConfirmation', 'enableErrorRecovery',
        'logLevel', 'performanceMonitoring', 'showActivationMessage', 'trackingMode',
        'uiTheme', 'search.caseSensitive', 'search.useRegex', 'search.maxResults',
        'search.highlightMatches', 'rollback.createBackupByDefault', 'rollback.resetContextByDefault',
        'rollback.showProgressDialog', 'rollback.maxRollbackHistory', 'storage.compressionEnabled',
        'storage.encryptionEnabled', 'storage.cleanupInterval', 'storage.maxStorageSize'
      ];
      
      for (const key of keys) {
        await config.update(key, undefined, vscode.ConfigurationTarget.Global);
        await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
      }
    }
  }

  /**
   * Export configuration to JSON
   */
  exportConfiguration(): string {
    const config = this.getConfiguration();
    return JSON.stringify(config, null, 2);
  }

  /**
   * Import configuration from JSON
   */
  async importConfiguration(
    configJson: string,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    try {
      const importedConfig = JSON.parse(configJson) as Partial<CursorCompanionConfig>;
      
      // Validate and apply configuration
      for (const [key, value] of Object.entries(importedConfig)) {
        if (this.isValidConfigKey(key)) {
          await this.updateConfiguration(key as keyof CursorCompanionConfig, value, target);
        }
      }
    } catch (error) {
      throw new Error(`Failed to import configuration: ${error instanceof Error ? error.message : 'Invalid JSON'}`);
    }
  }

  /**
   * Get configuration schema for validation
   */
  getConfigurationSchema(): ConfigurationSchema {
    return {
      autoTrack: { type: 'boolean', default: true, description: 'Automatically track Cursor conversations' },
      maxConversations: { type: 'number', default: 1000, min: 10, max: 10000, description: 'Maximum number of conversations to keep' },
      snapshotRetention: { type: 'number', default: 30, min: 1, max: 365, description: 'Number of days to retain file snapshots' },
      enableDiagnostics: { type: 'boolean', default: true, description: 'Enable diagnostic information collection' },
      autoBackup: { type: 'boolean', default: true, description: 'Automatically create backups before rollback operations' },
      maxBackups: { type: 'number', default: 10, min: 1, max: 100, description: 'Maximum number of backups to keep' },
      showRollbackConfirmation: { type: 'boolean', default: true, description: 'Show confirmation dialog before rollback operations' },
      enableErrorRecovery: { type: 'boolean', default: true, description: 'Enable automatic error recovery' },
      logLevel: { type: 'string', default: 'info', enum: ['error', 'warning', 'info', 'debug'], description: 'Logging level for diagnostic information' },
      performanceMonitoring: { type: 'boolean', default: true, description: 'Enable performance monitoring' },
      showActivationMessage: { type: 'boolean', default: true, description: 'Show message when extension activates' },
      trackingMode: { type: 'string', default: 'automatic', enum: ['automatic', 'manual', 'disabled'], description: 'Conversation tracking mode' },
      uiTheme: { type: 'string', default: 'auto', enum: ['auto', 'light', 'dark'], description: 'UI theme preference' }
    };
  }

  /**
   * Validate configuration value
   */
  validateConfiguration<K extends keyof CursorCompanionConfig>(
    key: K,
    value: CursorCompanionConfig[K]
  ): ValidationResult {
    const schema = this.getConfigurationSchema();
    const fieldSchema = schema[key];
    
    if (!fieldSchema) {
      return { valid: false, error: `Unknown configuration key: ${key}` };
    }
    
    // Type validation
    if (typeof value !== fieldSchema.type) {
      return { valid: false, error: `Expected ${fieldSchema.type}, got ${typeof value}` };
    }
    
    // Range validation for numbers
    if (fieldSchema.type === 'number' && typeof value === 'number') {
      if (fieldSchema.min !== undefined && value < fieldSchema.min) {
        return { valid: false, error: `Value must be at least ${fieldSchema.min}` };
      }
      if (fieldSchema.max !== undefined && value > fieldSchema.max) {
        return { valid: false, error: `Value must be at most ${fieldSchema.max}` };
      }
    }
    
    // Enum validation for strings
    if (fieldSchema.type === 'string' && fieldSchema.enum && typeof value === 'string') {
      if (!fieldSchema.enum.includes(value)) {
        return { valid: false, error: `Value must be one of: ${fieldSchema.enum.join(', ')}` };
      }
    }
    
    return { valid: true };
  }

  /**
   * Register a configuration change listener
   */
  onConfigurationChanged(listener: (config: CursorCompanionConfig) => void): vscode.Disposable {
    this.configChangeListeners.push(listener);
    
    return new vscode.Disposable(() => {
      const index = this.configChangeListeners.indexOf(listener);
      if (index > -1) {
        this.configChangeListeners.splice(index, 1);
      }
    });
  }

  /**
   * Show configuration UI
   */
  async showConfigurationUI(): Promise<void> {
    const config = this.getConfiguration();
    const schema = this.getConfigurationSchema();
    
    const items: vscode.QuickPickItem[] = Object.entries(schema).map(([key, fieldSchema]) => ({
      label: key,
      description: String((config as any)[key]),
      detail: fieldSchema.description
    }));
    
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a setting to modify',
      matchOnDescription: true,
      matchOnDetail: true
    });
    
    if (selected) {
      await this.showSettingEditor(selected.label as keyof CursorCompanionConfig);
    }
  }

  /**
   * Show setting editor for a specific configuration key
   */
  private async showSettingEditor<K extends keyof CursorCompanionConfig>(key: K): Promise<void> {
    const config = this.getConfiguration();
    const schema = this.getConfigurationSchema();
    const fieldSchema = schema[key];
    const currentValue = config[key];
    
    let newValue: any;
    
    if (fieldSchema.type === 'boolean') {
      const options = [
        { label: 'True', value: true },
        { label: 'False', value: false }
      ];
      
      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: `Select value for ${key}`
      });
      
      if (selected) {
        newValue = (selected as any).value;
      }
    } else if (fieldSchema.type === 'string' && fieldSchema.enum) {
      const options = fieldSchema.enum.map(value => ({
        label: value,
        value
      }));
      
      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: `Select value for ${key}`
      });
      
      if (selected) {
        newValue = (selected as any).value;
      }
    } else if (fieldSchema.type === 'number') {
      const input = await vscode.window.showInputBox({
        prompt: `Enter value for ${key}`,
        value: String(currentValue),
        validateInput: (value) => {
          const num = Number(value);
          if (isNaN(num)) {
            return 'Please enter a valid number';
          }
          
          const validation = this.validateConfiguration(key, num as any);
          return validation.valid ? undefined : validation.error;
        }
      });
      
      if (input !== undefined) {
        newValue = Number(input);
      }
    } else {
      const input = await vscode.window.showInputBox({
        prompt: `Enter value for ${key}`,
        value: String(currentValue),
        validateInput: (value) => {
          const validation = this.validateConfiguration(key, value as any);
          return validation.valid ? undefined : validation.error;
        }
      });
      
      if (input !== undefined) {
        newValue = input;
      }
    }
    
    if (newValue !== undefined && newValue !== currentValue) {
      try {
        await this.updateConfiguration(key, newValue);
        vscode.window.showInformationMessage(`Updated ${key} to ${newValue}`);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to update ${key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Setup configuration change watcher
   */
  private setupConfigurationWatcher(): void {
    const disposable = vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration(this.configSection)) {
        const newConfig = this.getConfiguration();
        
        // Notify all listeners
        this.configChangeListeners.forEach(listener => {
          try {
            listener(newConfig);
          } catch (error) {
            console.error('Configuration change listener error:', error);
          }
        });
      }
    });
    
    this.context.subscriptions.push(disposable);
  }

  /**
   * Check if a key is a valid configuration key
   */
  private isValidConfigKey(key: string): key is keyof CursorCompanionConfig {
    const schema = this.getConfigurationSchema();
    return key in schema;
  }

  /**
   * Get configuration migration info
   */
  getMigrationInfo(): ConfigurationMigrationInfo {
    const config = vscode.workspace.getConfiguration(this.configSection);
    const inspect = config.inspect('');
    
    return {
      hasGlobalSettings: inspect?.globalValue !== undefined,
      hasWorkspaceSettings: inspect?.workspaceValue !== undefined,
      hasWorkspaceFolderSettings: inspect?.workspaceFolderValue !== undefined,
      defaultValue: inspect?.defaultValue,
      globalValue: inspect?.globalValue,
      workspaceValue: inspect?.workspaceValue,
      workspaceFolderValue: inspect?.workspaceFolderValue
    };
  }

  /**
   * Migrate configuration from old format
   */
  async migrateConfiguration(): Promise<void> {
    // Check for old configuration keys and migrate them
    const config = vscode.workspace.getConfiguration();
    
    // Example migration from old 'cursorRollback' section
    const oldConfig = config.get('cursorRollback');
    if (oldConfig && typeof oldConfig === 'object') {
      console.log('Migrating configuration from cursorRollback to cursor-companion');
      
      // Migrate specific settings
      const oldSettings = oldConfig as any;
      if (oldSettings.autoTrack !== undefined) {
        await this.updateConfiguration('autoTrack', oldSettings.autoTrack);
      }
      if (oldSettings.maxBackups !== undefined) {
        await this.updateConfiguration('maxBackups', oldSettings.maxBackups);
      }
      
      // Clear old configuration
      await config.update('cursorRollback', undefined, vscode.ConfigurationTarget.Global);
      await config.update('cursorRollback', undefined, vscode.ConfigurationTarget.Workspace);
      
      vscode.window.showInformationMessage('Configuration migrated to new format');
    }
  }
}

// Types and interfaces

export type LogLevel = 'error' | 'warning' | 'info' | 'debug';
export type TrackingMode = 'automatic' | 'manual' | 'disabled';
export type UITheme = 'auto' | 'light' | 'dark';

export interface CursorCompanionConfig {
  autoTrack: boolean;
  maxConversations: number;
  snapshotRetention: number;
  enableDiagnostics: boolean;
  autoBackup: boolean;
  maxBackups: number;
  showRollbackConfirmation: boolean;
  enableErrorRecovery: boolean;
  logLevel: LogLevel;
  performanceMonitoring: boolean;
  showActivationMessage: boolean;
  trackingMode: TrackingMode;
  uiTheme: UITheme;
  searchSettings: {
    caseSensitive: boolean;
    useRegex: boolean;
    maxResults: number;
    highlightMatches: boolean;
  };
  rollbackSettings: {
    createBackupByDefault: boolean;
    resetContextByDefault: boolean;
    showProgressDialog: boolean;
    maxRollbackHistory: number;
  };
  storageSettings: {
    compressionEnabled: boolean;
    encryptionEnabled: boolean;
    cleanupInterval: number;
    maxStorageSize: number;
  };
}

export interface ConfigurationSchema {
  [key: string]: {
    type: 'boolean' | 'string' | 'number';
    default: any;
    description: string;
    min?: number;
    max?: number;
    enum?: string[];
  };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface ConfigurationMigrationInfo {
  hasGlobalSettings: boolean;
  hasWorkspaceSettings: boolean;
  hasWorkspaceFolderSettings: boolean;
  defaultValue: any;
  globalValue: any;
  workspaceValue: any;
  workspaceFolderValue: any;
}