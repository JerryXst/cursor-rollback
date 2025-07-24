import * as vscode from 'vscode';
import { RecoveryCommands } from './rollback/recoveryCommands';
import { 
  ConversationTracker,
  LocalFileStorage,
  RollbackManager,
  ErrorHandler,
  DiagnosticManager,
  BackupManager,
  SnapshotManager,
  HeuristicDetector,
  DataIndexer
} from './cursor-companion/services';
import { ConfigurationManager } from './cursor-companion/services/configurationManager';
import { 
  ConversationTreeProvider,
  UIManager,
  RollbackConfirmationProvider,
  ContextMenuProvider,
  SearchFilterProvider
} from './cursor-companion/ui';
import { ServiceContainer } from './cursor-companion/utils/container';

/**
 * Main extension activation function
 */
export async function activate(context: vscode.ExtensionContext) {
  console.log('Activating Cursor Companion extension...');

  try {
    // Initialize service container
    const serviceContainer = new ServiceContainer(context);
    
    // Initialize core services
    await initializeCoreServices(context, serviceContainer);
    
    // Initialize UI components
    await initializeUIComponents(context, serviceContainer);
    
    // Register all commands
    registerCommands(context, serviceContainer);
    
    // Set up Cursor API interceptors
    setupCursorCommandInterceptors(context, serviceContainer);
    
    // Initialize legacy recovery system for backward compatibility
    const recoveryCommands = new RecoveryCommands(context);
    
    console.log('Cursor Companion extension activated successfully!');
    
    // Show activation notification
    const config = serviceContainer.get('configManager') as ConfigurationManager;
    if (config.getConfiguration().showActivationMessage) {
      vscode.window.showInformationMessage(
        'Cursor Companion is now active and tracking your conversations!',
        'Open Panel', 'Settings'
      ).then(action => {
        if (action === 'Open Panel') {
          vscode.commands.executeCommand('cursorCompanionConversations.focus');
        } else if (action === 'Settings') {
          vscode.commands.executeCommand('workbench.action.openSettings', 'cursor-companion');
        }
      });
    }
    
  } catch (error) {
    console.error('Failed to activate Cursor Companion extension:', error);
    vscode.window.showErrorMessage(
      `Failed to activate Cursor Companion: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Initialize core services
 */
async function initializeCoreServices(
  context: vscode.ExtensionContext, 
  serviceContainer: ServiceContainer
): Promise<void> {
  // Initialize configuration manager first
  const configManager = ConfigurationManager.getInstance(context);
  serviceContainer.register('configManager', configManager);
  
  // Migrate configuration if needed
  await configManager.migrateConfiguration();
  
  // Initialize error handler
  const errorHandler = ErrorHandler.getInstance(context);
  serviceContainer.register('errorHandler', errorHandler);
  
  // Initialize storage
  const storage = new LocalFileStorage(context);
  await storage.initialize();
  serviceContainer.register('dataStorage', storage);
  
  // Initialize diagnostic manager
  const diagnosticManager = DiagnosticManager.getInstance(context, storage, errorHandler);
  serviceContainer.register('diagnosticManager', diagnosticManager);
  
  // Initialize backup manager
  const backupManager = new BackupManager(storage, context);
  serviceContainer.register('backupManager', backupManager);
  
  // Initialize snapshot manager
  const snapshotManager = new SnapshotManager(context, storage);
  serviceContainer.register('snapshotManager', snapshotManager);
  
  // Initialize heuristic detector
  const heuristicDetector = new HeuristicDetector();
  serviceContainer.register('heuristicDetector', heuristicDetector);
  
  // Initialize data indexer
  const dataIndexer = new DataIndexer(storage, context);
  serviceContainer.register('dataIndexer', dataIndexer);
  
  // Initialize rollback manager
  const rollbackManager = new RollbackManager(context, storage);
  serviceContainer.register('rollbackManager', rollbackManager);
  
  // Initialize conversation tracker
  const conversationTracker = new ConversationTracker(context);
  serviceContainer.register('conversationTracker', conversationTracker);
  
  // Start tracking
  await conversationTracker.startTracking();
  
  diagnosticManager.logActivity('Core services initialized', true);
}

/**
 * Initialize UI components
 */
async function initializeUIComponents(
  context: vscode.ExtensionContext,
  serviceContainer: ServiceContainer
): Promise<void> {
  const storage = serviceContainer.get('dataStorage') as LocalFileStorage;
  const rollbackManager = serviceContainer.get('rollbackManager') as RollbackManager;
  const diagnosticManager = serviceContainer.get('diagnosticManager') as DiagnosticManager;
  
  // Initialize tree provider
  const treeProvider = new ConversationTreeProvider(storage);
  serviceContainer.register('treeProvider', treeProvider);
  
  // Register tree view
  const treeView = vscode.window.createTreeView('cursorCompanionConversations', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: false
  });
  context.subscriptions.push(treeView);
  
  // Initialize UI manager
  const uiManager = new UIManager(context, storage as any, rollbackManager);
  await uiManager.initialize();
  serviceContainer.register('uiManager', uiManager);
  
  // Initialize rollback confirmation provider
  const rollbackConfirmation = new RollbackConfirmationProvider(storage as any);
  serviceContainer.register('rollbackConfirmation', rollbackConfirmation);
  
  // Initialize context menu provider
  const contextMenuProvider = new ContextMenuProvider(context, storage as any, rollbackManager);
  serviceContainer.register('contextMenuProvider', contextMenuProvider);
  
  // Initialize search filter provider
  const searchFilterProvider = new SearchFilterProvider(context, storage as any);
  serviceContainer.register('searchFilterProvider', searchFilterProvider);
  
  diagnosticManager.logActivity('UI components initialized', true);
}

/**
 * Register all extension commands
 */
function registerCommands(
  context: vscode.ExtensionContext,
  serviceContainer: ServiceContainer
): void {
  const storage = serviceContainer.get('dataStorage') as LocalFileStorage;
  const rollbackManager = serviceContainer.get('rollbackManager') as RollbackManager;
  const errorHandler = serviceContainer.get('errorHandler') as ErrorHandler;
  const diagnosticManager = serviceContainer.get('diagnosticManager') as DiagnosticManager;
  const backupManager = serviceContainer.get('backupManager') as BackupManager;
  const uiManager = serviceContainer.get('uiManager') as UIManager;
  const treeProvider = serviceContainer.get('treeProvider') as ConversationTreeProvider;
  const configManager = serviceContainer.get('configManager') as ConfigurationManager;
  
  // Conversation management commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorCompanion.refreshConversations', () => {
      treeProvider.refresh();
    }),
    
    vscode.commands.registerCommand('cursorCompanion.searchConversations', async () => {
      const query = await vscode.window.showInputBox({
        placeHolder: 'Search conversations...',
        prompt: 'Enter search query'
      });
      if (query) {
        uiManager.filterConversations(query);
      }
    }),
    
    vscode.commands.registerCommand('cursorCompanion.rollbackToMessage', async (messageId: string) => {
      try {
        const timer = diagnosticManager.startPerformanceTimer('rollback');
        const result = await rollbackManager.rollbackToMessage(messageId);
        timer.end();
        
        if (result.success) {
          diagnosticManager.logActivity('Rollback completed', true, { messageId, filesAffected: result.modifiedFiles.length });
        } else {
          diagnosticManager.logActivity('Rollback failed', false, { messageId, error: result.error });
        }
      } catch (error) {
        await errorHandler.handleError(error instanceof Error ? error : new Error('Rollback failed'), {
          operation: 'rollback',
          component: 'rollbackManager',
          data: { messageId }
        });
      }
    }),
    
    vscode.commands.registerCommand('cursorCompanion.archiveConversation', async (conversationId: string) => {
      try {
        await storage.archiveConversation(conversationId);
        treeProvider.refresh();
        diagnosticManager.logActivity('Conversation archived', true, { conversationId });
      } catch (error) {
        await errorHandler.handleError(error instanceof Error ? error : new Error('Archive failed'), {
          operation: 'archive',
          component: 'storage',
          data: { conversationId }
        });
      }
    }),
    
    vscode.commands.registerCommand('cursorCompanion.deleteConversation', async (conversationId: string) => {
      const confirmed = await vscode.window.showWarningMessage(
        'Are you sure you want to delete this conversation? This action cannot be undone.',
        { modal: true },
        'Delete'
      );
      
      if (confirmed === 'Delete') {
        try {
          await storage.deleteConversation(conversationId);
          treeProvider.refresh();
          diagnosticManager.logActivity('Conversation deleted', true, { conversationId });
        } catch (error) {
          await errorHandler.handleError(error instanceof Error ? error : new Error('Delete failed'), {
            operation: 'delete',
            component: 'storage',
            data: { conversationId }
          });
        }
      }
    })
  );
  
  // Diagnostic and debugging commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorCompanion.showDiagnostics', async () => {
      await diagnosticManager.showDiagnosticReport();
    }),
    
    vscode.commands.registerCommand('cursorCompanion.runHealthCheck', async () => {
      await diagnosticManager.showHealthCheck();
    }),
    
    vscode.commands.registerCommand('cursorCompanion.exportDiagnostics', async () => {
      const data = await diagnosticManager.exportDiagnosticData();
      const document = await vscode.workspace.openTextDocument({
        content: data,
        language: 'json'
      });
      await vscode.window.showTextDocument(document);
    }),
    
    vscode.commands.registerCommand('cursorCompanion.clearErrorLog', async () => {
      await errorHandler.clearErrorLog();
      vscode.window.showInformationMessage('Error log cleared');
    }),
    
    vscode.commands.registerCommand('cursorCompanion.showErrorStatistics', async () => {
      const stats = errorHandler.getErrorStatistics();
      const report = [
        '# Error Statistics',
        '',
        `**Total Errors:** ${stats.totalErrors}`,
        `**Errors (24h):** ${stats.errorsLast24Hours}`,
        `**Errors (7d):** ${stats.errorsLastWeek}`,
        `**Recovery Rate:** ${stats.recoverySuccessRate}%`,
        `**Most Common:** ${stats.mostCommonError}`,
        '',
        '## By Category',
        ...Object.entries(stats.errorsByCategory).map(([category, count]) => `- ${category}: ${count}`)
      ].join('\n');
      
      const document = await vscode.workspace.openTextDocument({
        content: report,
        language: 'markdown'
      });
      await vscode.window.showTextDocument(document);
    }),
    
    vscode.commands.registerCommand('cursorCompanion.resetExtensionState', async () => {
      const confirmed = await vscode.window.showWarningMessage(
        'This will reset all extension state and reload the window. Continue?',
        { modal: true },
        'Reset'
      );
      
      if (confirmed === 'Reset') {
        // Clear all state
        const keys = context.globalState.keys();
        for (const key of keys) {
          await context.globalState.update(key, undefined);
        }
        
        vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    })
  );
  
  // Backup management commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorCompanion.createBackup', async () => {
      try {
        const description = await vscode.window.showInputBox({
          placeHolder: 'Backup description (optional)',
          prompt: 'Enter a description for this backup'
        });
        
        const backupId = await rollbackManager.createBackup(description);
        vscode.window.showInformationMessage(`Backup created: ${backupId}`);
        diagnosticManager.logActivity('Manual backup created', true, { backupId });
      } catch (error) {
        await errorHandler.handleError(error instanceof Error ? error : new Error('Backup failed'), {
          operation: 'backup',
          component: 'rollbackManager'
        });
      }
    }),
    
    vscode.commands.registerCommand('cursorCompanion.listBackups', async () => {
      try {
        const backups = await rollbackManager.listBackups();
        
        if (backups.length === 0) {
          vscode.window.showInformationMessage('No backups found');
          return;
        }
        
        const selected = await vscode.window.showQuickPick(
          backups.map(backup => ({
            label: backup.id,
            description: new Date(backup.timestamp).toLocaleString(),
            detail: backup.description || 'No description',
            backup
          })),
          { placeHolder: 'Select a backup to restore or manage' }
        );
        
        if (selected) {
          const action = await vscode.window.showQuickPick([
            { label: 'Restore', value: 'restore' },
            { label: 'Delete', value: 'delete' },
            { label: 'View Details', value: 'details' }
          ], { placeHolder: 'Choose an action' });
          
          if (action?.value === 'restore') {
            await rollbackManager.restoreBackup((selected as any).backup.id);
            vscode.window.showInformationMessage('Backup restored successfully');
          } else if (action?.value === 'delete') {
            await rollbackManager.deleteBackup((selected as any).backup.id);
            vscode.window.showInformationMessage('Backup deleted');
          }
        }
      } catch (error) {
        await errorHandler.handleError(error instanceof Error ? error : new Error('Backup operation failed'), {
          operation: 'listBackups',
          component: 'rollbackManager'
        });
      }
    })
  );
  
  // Legacy commands for backward compatibility
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorRollback.restoreCheckpoint', async () => {
      vscode.window.showInformationMessage('Please use the new Cursor Companion panel for rollback operations');
      vscode.commands.executeCommand('cursorCompanionConversations.focus');
    }),
    
    vscode.commands.registerCommand('cursorRollback.rewindChat', async () => {
      vscode.window.showInformationMessage('Please use the new Cursor Companion panel for conversation management');
      vscode.commands.executeCommand('cursorCompanionConversations.focus');
    })
  );
  
  // Configuration management commands
  context.subscriptions.push(
    vscode.commands.registerCommand('cursorCompanion.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'cursor-companion');
    }),
    
    vscode.commands.registerCommand('cursorCompanion.showConfigurationUI', async () => {
      await configManager.showConfigurationUI();
    }),
    
    vscode.commands.registerCommand('cursorCompanion.exportConfiguration', async () => {
      try {
        const configJson = configManager.exportConfiguration();
        const document = await vscode.workspace.openTextDocument({
          content: configJson,
          language: 'json'
        });
        await vscode.window.showTextDocument(document);
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to export configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }),
    
    vscode.commands.registerCommand('cursorCompanion.importConfiguration', async () => {
      try {
        const fileUri = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          filters: {
            'JSON files': ['json']
          }
        });
        
        if (fileUri && fileUri[0]) {
          const fileContent = await vscode.workspace.fs.readFile(fileUri[0]);
          const configJson = fileContent.toString();
          
          const target = await vscode.window.showQuickPick([
            { label: 'Global', value: vscode.ConfigurationTarget.Global },
            { label: 'Workspace', value: vscode.ConfigurationTarget.Workspace }
          ], { placeHolder: 'Select configuration target' });
          
          if (target) {
            await configManager.importConfiguration(configJson, target.value);
            vscode.window.showInformationMessage('Configuration imported successfully');
          }
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to import configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }),
    
    vscode.commands.registerCommand('cursorCompanion.resetConfiguration', async () => {
      const confirmed = await vscode.window.showWarningMessage(
        'This will reset all Cursor Companion settings to their default values. Continue?',
        { modal: true },
        'Reset'
      );
      
      if (confirmed === 'Reset') {
        try {
          await configManager.resetConfiguration();
          vscode.window.showInformationMessage('Configuration reset to defaults');
        } catch (error) {
          vscode.window.showErrorMessage(`Failed to reset configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    }),
    
    vscode.commands.registerCommand('cursorCompanion.migrateConfiguration', async () => {
      try {
        await configManager.migrateConfiguration();
        vscode.window.showInformationMessage('Configuration migration completed');
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to migrate configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    })
  );
  
  diagnosticManager.logActivity('Commands registered', true);
}

/**
 * Set up command interceptors for Cursor API commands
 */
function setupCursorCommandInterceptors(
  context: vscode.ExtensionContext,
  serviceContainer: ServiceContainer
): void {
  const conversationTracker = serviceContainer.get('conversationTracker') as ConversationTracker;
  const diagnosticManager = serviceContainer.get('diagnosticManager') as DiagnosticManager;
  
  // List of Cursor commands to intercept
  const cursorCommands = [
    'cursor.agent.listCheckpoints',
    'cursor.agent.restoreCheckpoint',
    'cursor.agent.createCheckpoint',
    'cursor.chat.new',
    'cursor.chat.duplicate',
    'cursor.chat.submit',
    'cursor.chat.response'
  ];
  
  for (const command of cursorCommands) {
    try {
      // Create interceptor that notifies our tracker
      const interceptorDisposable = vscode.commands.registerCommand(`_intercept.${command}`, async (args: any) => {
        diagnosticManager.logActivity(`Cursor command intercepted: ${command}`, true, { args });
        
        // Notify conversation tracker
        if (conversationTracker && typeof (conversationTracker as any).onCursorCommand === 'function') {
          await (conversationTracker as any).onCursorCommand(command, args);
        }
        
        // Execute original command
        try {
          return await vscode.commands.executeCommand(command, args);
        } catch (error) {
          diagnosticManager.logActivity(`Cursor command failed: ${command}`, false, { error: error instanceof Error ? error.message : 'Unknown error' });
          throw error;
        }
      });
      
      context.subscriptions.push(interceptorDisposable);
    } catch (error) {
      console.warn(`Failed to set up interceptor for ${command}:`, error);
    }
  }
  
  diagnosticManager.logActivity('Cursor command interceptors set up', true);
}

/**
 * Extension deactivation
 */
export function deactivate() {
  console.log('Deactivating Cursor Companion extension...');
}
