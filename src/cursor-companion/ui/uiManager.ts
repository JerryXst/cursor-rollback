import * as vscode from 'vscode';
import { ConversationTreeProvider } from './conversationTreeProvider';
import { MessageDisplayProvider } from './messageDisplayProvider';
import { ConversationExpandManager } from './conversationExpandManager';
import { SearchFilterProvider, SearchResult } from './searchFilterProvider';
import { ContextMenuProvider } from './contextMenuProvider';
import { IDataStorage, IRollbackManager, IUIManager } from '../services/interfaces';

/**
 * Manages all UI components for Cursor Companion
 */
export class UIManager implements IUIManager {
  private conversationTreeProvider: ConversationTreeProvider;
  private conversationTreeView: vscode.TreeView<any>;
  private messageDisplayProvider: MessageDisplayProvider;
  private expandManager: ConversationExpandManager;
  private searchFilterProvider: SearchFilterProvider;
  private contextMenuProvider: ContextMenuProvider;
  private rollbackCallbacks: Array<(messageId: string) => void> = [];
  
  // Search state
  private currentSearchResults: SearchResult[] = [];
  private isSearchMode = false;

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage,
    private rollbackManager: IRollbackManager
  ) {
    // Initialize expand manager first
    this.expandManager = new ConversationExpandManager(context, dataStorage);
    
    // Initialize message display provider with expand manager
    this.messageDisplayProvider = new MessageDisplayProvider(context, dataStorage, this.expandManager);
    
    // Initialize search filter provider
    this.searchFilterProvider = new SearchFilterProvider(context, dataStorage);
    
    // Initialize context menu provider
    this.contextMenuProvider = new ContextMenuProvider(context, dataStorage, rollbackManager);
    
    // Initialize tree provider with message display provider
    this.conversationTreeProvider = new ConversationTreeProvider(dataStorage);
    
    // Create tree view
    this.conversationTreeView = vscode.window.createTreeView('cursorCompanionConversations', {
      treeDataProvider: this.conversationTreeProvider,
      showCollapseAll: true,
      canSelectMany: false
    });
  }

  async initialize(): Promise<void> {
    try {
      // Register commands
      this.registerCommands();
      
      // Load initial data
      await this.conversationTreeProvider.loadConversations();
      
      // Set up event listeners
      this.setupEventListeners();
      
      console.log('Cursor Companion UI initialized');
    } catch (error) {
      throw new Error(`Failed to initialize UI: ${error}`);
    }
  }

  showConversationPanel(): void {
    // Focus on the conversation tree view
    this.conversationTreeView.reveal(undefined, { focus: true, select: false });
  }

  refreshConversationList(): void {
    this.conversationTreeProvider.refresh();
  }

  filterConversations(query: string): void {
    this.conversationTreeProvider.filterConversations(query);
  }

  onRollbackRequest(callback: (messageId: string) => void): void {
    this.rollbackCallbacks.push(callback);
  }

  private registerCommands(): void {
    // Refresh conversations
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.refreshConversations', () => {
        this.conversationTreeProvider.forceRefresh();
      })
    );

    // Search conversations
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.searchConversations', async () => {
        const query = await vscode.window.showInputBox({
          prompt: 'Search conversations',
          placeHolder: 'Enter search terms...'
        });

        if (query !== undefined) {
          this.filterConversations(query);
        }
      })
    );

    // Clear filters
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.clearFilters', () => {
        this.conversationTreeProvider.clearFilters();
      })
    );

    // Filter by status
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.filterByStatus', async () => {
        const status = await vscode.window.showQuickPick([
          { label: 'All', value: 'all' },
          { label: 'Active', value: 'active' },
          { label: 'Archived', value: 'archived' }
        ], {
          placeHolder: 'Select status filter'
        });

        if (status) {
          this.conversationTreeProvider.filterByStatus(status.value as any);
        }
      })
    );

    // Select conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.selectConversation', async (conversationId: string) => {
        await this.selectConversation(conversationId);
      })
    );

    // Select message
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.selectMessage', async (messageId: string) => {
        await this.showMessageDetails(messageId);
      })
    );

    // Show message details
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showMessageDetails', async (messageId: string) => {
        await this.showMessageDetails(messageId);
      })
    );

    // Rollback to message
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.rollbackToMessage', async (messageId: string) => {
        await this.handleRollbackRequest(messageId);
      })
    );

    // Archive conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.archiveConversation', async (item: any) => {
        if (item && item.conversation) {
          await this.conversationTreeProvider.archiveConversation(item.conversation.id);
        }
      })
    );

    // Delete conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.deleteConversation', async (item: any) => {
        if (item && item.conversation) {
          await this.conversationTreeProvider.deleteConversation(item.conversation.id);
        }
      })
    );

    // Export conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.exportConversation', async (item: any) => {
        if (item && item.conversation) {
          await this.conversationTreeProvider.exportConversation(item.conversation.id);
        }
      })
    );

    // Duplicate conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.duplicateConversation', async (item: any) => {
        if (item && item.conversation) {
          await this.conversationTreeProvider.duplicateConversation(item.conversation.id);
        }
      })
    );

    // Retry load messages
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.retryLoadMessages', async (conversationId: string) => {
        await this.conversationTreeProvider.retryLoadMessages(conversationId);
      })
    );

    // Show rollback options
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showRollbackOptions', async () => {
        await this.showRollbackOptions();
      })
    );

    // Show conversation stats
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showStats', async () => {
        await this.showConversationStats();
      })
    );

    // Search in messages
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.searchInMessages', async () => {
        await this.searchInMessages();
      })
    );

    // Toggle message expansion
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.toggleMessageExpansion', async (conversationId: string, messageId: string) => {
        const isExpanded = this.expandManager.toggleMessageExpansion(conversationId, messageId);
        this.conversationTreeProvider.refresh();
        
        if (isExpanded) {
          vscode.window.showInformationMessage('Message expanded');
        } else {
          vscode.window.showInformationMessage('Message collapsed');
        }
      })
    );

    // Show code change diff
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showCodeChangeDiff', async (codeChange: any, messageId: string) => {
        await this.showCodeChangeDiff(codeChange, messageId);
      })
    );

    // Expand all messages in conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.expandAllMessages', async (conversationId: string) => {
        const messages = await this.dataStorage.getMessages(conversationId);
        const messageIds = messages.map(m => m.id);
        this.expandManager.expandAllMessages(conversationId, messageIds);
        this.conversationTreeProvider.refresh();
        vscode.window.showInformationMessage('All messages expanded');
      })
    );

    // Collapse all messages in conversation
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.collapseAllMessages', async (conversationId: string) => {
        this.expandManager.collapseAllMessages(conversationId);
        this.conversationTreeProvider.refresh();
        vscode.window.showInformationMessage('All messages collapsed');
      })
    );

    // Advanced search
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.advancedSearch', async () => {
        await this.showAdvancedSearch();
      })
    );

    // Quick search
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.quickSearch', async () => {
        await this.showQuickSearch();
      })
    );

    // Clear search
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.clearSearch', () => {
        this.clearSearch();
      })
    );

    // Show search suggestions
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showSearchSuggestions', async () => {
        await this.showSearchSuggestions();
      })
    );

    // Export search results
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.exportSearchResults', async () => {
        if (this.currentSearchResults.length > 0) {
          await this.searchFilterProvider.exportSearchResults(this.currentSearchResults);
        } else {
          vscode.window.showInformationMessage('No search results to export');
        }
      })
    );

    // Filter by status
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.filterByStatus', async () => {
        await this.showStatusFilter();
      })
    );

    // Filter by tags
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.filterByTags', async () => {
        await this.showTagFilter();
      })
    );

    // Filter by date range
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.filterByDateRange', async () => {
        await this.showDateRangeFilter();
      })
    );

    // Show search history
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showSearchHistory', async () => {
        await this.showSearchHistory();
      })
    );

    // Context menu actions
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showConversationContextMenu', async (conversation: any) => {
        await this.showConversationContextMenu(conversation);
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.showMessageContextMenu', async (message: any, conversation: any) => {
        await this.showMessageContextMenu(message, conversation);
      })
    );

    // Action buttons
    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.addTag', async (conversationId: string) => {
        const conversation = await this.dataStorage.getConversation(conversationId);
        if (conversation) {
          await this.contextMenuProvider.executeAction('addTag', conversation);
          this.conversationTreeProvider.refresh();
        }
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.removeTag', async (conversationId: string) => {
        const conversation = await this.dataStorage.getConversation(conversationId);
        if (conversation) {
          await this.contextMenuProvider.executeAction('removeTag', conversation);
          this.conversationTreeProvider.refresh();
        }
      })
    );

    this.context.subscriptions.push(
      vscode.commands.registerCommand('cursorCompanion.copyMessageContent', async (messageId: string) => {
        const message = await this.dataStorage.getMessage(messageId);
        if (message) {
          await this.contextMenuProvider.executeAction('copyContent', message);
        }
      })
    );
  }

  private setupEventListeners(): void {
    // Listen for tree view selection changes
    this.conversationTreeView.onDidChangeSelection(event => {
      // Handle selection changes if needed
    });

    // Listen for tree view expansion
    this.conversationTreeView.onDidExpandElement(event => {
      if (event.element && event.element.conversation) {
        this.conversationTreeProvider.expandConversation(event.element.conversation.id);
        this.expandManager.toggleConversationExpansion(event.element.conversation.id);
      }
    });

    // Listen for tree view collapse
    this.conversationTreeView.onDidCollapseElement(event => {
      if (event.element && event.element.conversation) {
        this.conversationTreeProvider.collapseConversation(event.element.conversation.id);
        // Conversation collapsed - no specific action needed as state is managed automatically
      }
    });
  }

  private async showMessageDetails(messageId: string): Promise<void> {
    try {
      const message = await this.dataStorage.getMessage(messageId);
      if (!message) {
        vscode.window.showErrorMessage('Message not found');
        return;
      }

      // Create a webview to show message details
      const panel = vscode.window.createWebviewPanel(
        'messageDetails',
        'Message Details',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      // Generate enhanced HTML using the message display provider
      const messageHtml = this.getMessageDetailsHtml(message);

      panel.webview.html = this.getEnhancedMessageDetailsHtml(messageHtml, message);

      // Handle messages from the webview
      panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
          case 'rollback':
            await this.handleRollbackRequest(messageId);
            break;
        }
      });

    } catch (error) {
      console.error(`Failed to show message details for ${messageId}:`, error);
      vscode.window.showErrorMessage('Failed to show message details');
    }
  }

  private async handleRollbackRequest(messageId: string): Promise<void> {
    try {
      // Check if rollback is possible
      const canRollback = await this.rollbackManager.canRollback(messageId);
      if (!canRollback) {
        vscode.window.showWarningMessage('Cannot rollback to this message - no snapshot available');
        return;
      }

      // Confirm rollback
      const result = await vscode.window.showWarningMessage(
        'Are you sure you want to rollback to this message? This will restore your code to the state at this point in the conversation.',
        { modal: true },
        'Rollback'
      );

      if (result === 'Rollback') {
        // Show progress
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: 'Rolling back...',
          cancellable: false
        }, async (progress) => {
          progress.report({ increment: 0, message: 'Creating backup...' });
          
          // Notify callbacks
          this.rollbackCallbacks.forEach(callback => {
            try {
              callback(messageId);
            } catch (error) {
              console.error('Error in rollback callback:', error);
            }
          });

          progress.report({ increment: 50, message: 'Restoring files...' });
          
          // Perform rollback
          const rollbackResult = await this.rollbackManager.rollbackToMessage(messageId);
          
          progress.report({ increment: 100, message: 'Complete' });

          if (rollbackResult.success) {
            vscode.window.showInformationMessage(
              `Rollback successful! ${rollbackResult.modifiedFiles.length} files restored.`
            );
          } else {
            vscode.window.showErrorMessage(`Rollback failed: ${rollbackResult.error}`);
          }
        });
      }

    } catch (error) {
      console.error(`Failed to handle rollback request for ${messageId}:`, error);
      vscode.window.showErrorMessage('Failed to perform rollback');
    }
  }

  private async showRollbackOptions(): Promise<void> {
    try {
      const backups = await this.rollbackManager.listBackups();
      
      if (backups.length === 0) {
        vscode.window.showInformationMessage('No backups available');
        return;
      }

      const items = backups.map(backup => ({
        label: backup.description || `Backup ${backup.id}`,
        description: new Date(backup.timestamp).toLocaleString(),
        backupId: backup.id
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a backup to restore'
      });

      if (selected) {
        const result = await vscode.window.showWarningMessage(
          'Are you sure you want to restore this backup? This will overwrite your current workspace.',
          { modal: true },
          'Restore'
        );

        if (result === 'Restore') {
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Restoring backup...',
            cancellable: false
          }, async () => {
            await this.rollbackManager.restoreBackup(selected.backupId);
            vscode.window.showInformationMessage('Backup restored successfully');
          });
        }
      }

    } catch (error) {
      console.error('Failed to show rollback options:', error);
      vscode.window.showErrorMessage('Failed to show rollback options');
    }
  }

  private async selectConversation(conversationId: string): Promise<void> {
    try {
      const conversation = await this.dataStorage.getConversation(conversationId);
      if (!conversation) {
        vscode.window.showErrorMessage('Conversation not found');
        return;
      }

      // Show conversation details in a quick pick
      const messages = await this.dataStorage.getMessages(conversationId);
      const items = messages.map(message => ({
        label: `${message.sender === 'user' ? '👤' : '🤖'} ${message.content.substring(0, 100)}...`,
        description: new Date(message.timestamp).toLocaleString(),
        messageId: message.id
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Messages in "${conversation.title}" (${messages.length} total)`
      });

      if (selected) {
        await this.showMessageDetails(selected.messageId);
      }
    } catch (error) {
      console.error(`Failed to select conversation ${conversationId}:`, error);
      vscode.window.showErrorMessage('Failed to load conversation');
    }
  }

  private async showConversationStats(): Promise<void> {
    try {
      const stats = await this.conversationTreeProvider.getConversationStats();
      
      const message = `Conversation Statistics:
      
Total Conversations: ${stats.total}
Active: ${stats.active}
Archived: ${stats.archived}
Total Messages: ${stats.totalMessages}`;

      vscode.window.showInformationMessage(message);
    } catch (error) {
      console.error('Failed to show conversation stats:', error);
      vscode.window.showErrorMessage('Failed to load conversation statistics');
    }
  }

  private async searchInMessages(): Promise<void> {
    try {
      const query = await vscode.window.showInputBox({
        prompt: 'Search in message content',
        placeHolder: 'Enter search terms...'
      });

      if (!query) {
        return;
      }

      // Use the new search filter provider
      const results = await this.searchFilterProvider.searchImmediate(query);
      
      if (results.length === 0) {
        vscode.window.showInformationMessage('No messages found matching your search');
        return;
      }

      this.currentSearchResults = results;
      this.isSearchMode = true;

      const items = results.map(result => ({
        label: `${result.message?.sender === 'user' ? '👤' : '🤖'} ${result.highlightedText.substring(0, 100)}...`,
        description: `${result.conversation.title} • ${result.matchType} match`,
        result
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Found ${results.length} results matching "${query}"`
      });

      if (selected && selected.result.message) {
        await this.showMessageDetails(selected.result.message.id);
      }
    } catch (error) {
      console.error('Failed to search in messages:', error);
      vscode.window.showErrorMessage('Failed to search messages');
    }
  }

  private async showAdvancedSearch(): Promise<void> {
    try {
      const filter = await this.searchFilterProvider.showAdvancedSearchDialog();
      
      if (filter) {
        await this.searchFilterProvider.applyFilter(filter);
        
        if (filter.query) {
          const results = await this.searchFilterProvider.searchImmediate(filter.query, filter);
          this.currentSearchResults = results;
          this.isSearchMode = true;
          
          if (results.length > 0) {
            vscode.window.showInformationMessage(`Found ${results.length} results`);
            await this.showSearchResultsQuickPick(results);
          } else {
            vscode.window.showInformationMessage('No results found');
          }
        } else {
          // Just apply filter without search
          this.conversationTreeProvider.refresh();
          vscode.window.showInformationMessage('Filter applied');
        }
      }
    } catch (error) {
      console.error('Failed to show advanced search:', error);
      vscode.window.showErrorMessage('Failed to show advanced search');
    }
  }

  private async showQuickSearch(): Promise<void> {
    try {
      const query = await vscode.window.showInputBox({
        prompt: 'Quick search in conversations and messages',
        placeHolder: 'Enter search terms...'
      });

      if (!query) {
        return;
      }

      // Show progress
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Searching...',
        cancellable: false
      }, async (progress) => {
        progress.report({ increment: 0, message: 'Searching conversations and messages...' });
        
        const results = await this.searchFilterProvider.searchImmediate(query);
        this.currentSearchResults = results;
        this.isSearchMode = true;
        
        progress.report({ increment: 100, message: 'Complete' });
        
        if (results.length > 0) {
          await this.showSearchResultsQuickPick(results);
        } else {
          vscode.window.showInformationMessage('No results found');
        }
      });
    } catch (error) {
      console.error('Failed to perform quick search:', error);
      vscode.window.showErrorMessage('Failed to perform search');
    }
  }

  private clearSearch(): void {
    this.currentSearchResults = [];
    this.isSearchMode = false;
    this.searchFilterProvider.clearFilters();
    this.conversationTreeProvider.refresh();
    vscode.window.showInformationMessage('Search cleared');
  }

  private async showSearchSuggestions(): Promise<void> {
    try {
      const input = await vscode.window.showInputBox({
        prompt: 'Start typing to see suggestions',
        placeHolder: 'Search terms...'
      });

      if (!input) {
        return;
      }

      const suggestions = await this.searchFilterProvider.getSearchSuggestions(input);
      
      if (suggestions.length === 0) {
        vscode.window.showInformationMessage('No suggestions available');
        return;
      }

      const items = suggestions.map(suggestion => ({
        label: suggestion.text,
        description: `${suggestion.type}${suggestion.frequency ? ` (${suggestion.frequency})` : ''}`,
        suggestion
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a suggestion to search'
      });

      if (selected) {
        const results = await this.searchFilterProvider.searchImmediate(selected.suggestion.text);
        this.currentSearchResults = results;
        this.isSearchMode = true;
        
        if (results.length > 0) {
          await this.showSearchResultsQuickPick(results);
        } else {
          vscode.window.showInformationMessage('No results found');
        }
      }
    } catch (error) {
      console.error('Failed to show search suggestions:', error);
      vscode.window.showErrorMessage('Failed to show suggestions');
    }
  }

  private async showSearchResultsQuickPick(results: SearchResult[]): Promise<void> {
    const items = results.map(result => {
      let icon = '💬';
      if (result.matchType === 'title') {
        icon = '📝';
      } else if (result.matchType === 'tag') {
        icon = '🏷️';
      } else if (result.message?.sender === 'user') {
        icon = '👤';
      } else if (result.message?.sender === 'ai') {
        icon = '🤖';
      }

      return {
        label: `${icon} ${result.highlightedText.substring(0, 80)}...`,
        description: `${result.conversation.title} • ${result.matchType} match • Score: ${result.score}`,
        detail: result.message ? new Date(result.message.timestamp).toLocaleString() : new Date(result.conversation.timestamp).toLocaleString(),
        result
      };
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `${results.length} search results`,
      matchOnDescription: true,
      matchOnDetail: true
    });

    if (selected) {
      if (selected.result.message) {
        await this.showMessageDetails(selected.result.message.id);
      } else {
        await this.selectConversation(selected.result.conversation.id);
      }
    }
  }

  private async showStatusFilter(): Promise<void> {
    const statusOptions = [
      { label: 'All conversations', value: 'all' as const },
      { label: 'Active conversations', value: 'active' as const },
      { label: 'Archived conversations', value: 'archived' as const }
    ];

    const selected = await vscode.window.showQuickPick(statusOptions, {
      placeHolder: 'Filter by conversation status'
    });

    if (selected) {
      await this.searchFilterProvider.applyFilter({ status: selected.value });
      this.conversationTreeProvider.refresh();
      vscode.window.showInformationMessage(`Filtered by status: ${selected.label}`);
    }
  }

  private async showTagFilter(): Promise<void> {
    try {
      const conversations = await this.dataStorage.getConversations();
      const allTags = new Set<string>();

      for (const conversation of conversations) {
        if (conversation.metadata?.tags) {
          conversation.metadata.tags.forEach(tag => allTags.add(tag));
        }
      }

      if (allTags.size === 0) {
        vscode.window.showInformationMessage('No tags found in conversations');
        return;
      }

      const tagItems = Array.from(allTags).map(tag => ({
        label: tag,
        picked: false
      }));

      const selectedTags = await vscode.window.showQuickPick(tagItems, {
        placeHolder: 'Select tags to filter by',
        canPickMany: true
      });

      if (selectedTags && selectedTags.length > 0) {
        const tags = selectedTags.map(item => item.label);
        await this.searchFilterProvider.applyFilter({ tags });
        this.conversationTreeProvider.refresh();
        vscode.window.showInformationMessage(`Filtered by tags: ${tags.join(', ')}`);
      }
    } catch (error) {
      console.error('Failed to show tag filter:', error);
      vscode.window.showErrorMessage('Failed to show tag filter');
    }
  }

  private async showDateRangeFilter(): Promise<void> {
    try {
      const startDate = await vscode.window.showInputBox({
        prompt: 'Enter start date (YYYY-MM-DD)',
        placeHolder: '2024-01-01',
        validateInput: (value) => {
          if (value && !this.isValidDate(value)) {
            return 'Please enter a valid date in YYYY-MM-DD format';
          }
          return undefined;
        }
      });

      if (!startDate) {
        return;
      }

      const endDate = await vscode.window.showInputBox({
        prompt: 'Enter end date (YYYY-MM-DD)',
        placeHolder: '2024-12-31',
        validateInput: (value) => {
          if (value && !this.isValidDate(value)) {
            return 'Please enter a valid date in YYYY-MM-DD format';
          }
          return undefined;
        }
      });

      if (!endDate) {
        return;
      }

      await this.searchFilterProvider.applyFilter({
        dateRange: {
          start: new Date(startDate),
          end: new Date(endDate)
        }
      });

      this.conversationTreeProvider.refresh();
      vscode.window.showInformationMessage(`Filtered by date range: ${startDate} to ${endDate}`);
    } catch (error) {
      console.error('Failed to show date range filter:', error);
      vscode.window.showErrorMessage('Failed to show date range filter');
    }
  }

  private async showSearchHistory(): Promise<void> {
    try {
      const history = this.searchFilterProvider.getSearchHistory();
      
      if (history.length === 0) {
        vscode.window.showInformationMessage('No search history available');
        return;
      }

      const items = history.map(item => ({
        label: item.query,
        description: `${item.resultCount} results`,
        detail: new Date(item.timestamp).toLocaleString(),
        query: item.query
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select from search history'
      });

      if (selected) {
        const results = await this.searchFilterProvider.searchImmediate(selected.query);
        this.currentSearchResults = results;
        this.isSearchMode = true;
        
        if (results.length > 0) {
          await this.showSearchResultsQuickPick(results);
        } else {
          vscode.window.showInformationMessage('No results found');
        }
      }
    } catch (error) {
      console.error('Failed to show search history:', error);
      vscode.window.showErrorMessage('Failed to show search history');
    }
  }

  private isValidDate(dateString: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) {
      return false;
    }

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  private async showConversationContextMenu(conversation: any): Promise<void> {
    try {
      const menuItems = this.contextMenuProvider.getConversationContextMenu(conversation);
      
      const quickPickItems = menuItems
        .filter(item => item.visible && item.group !== 'separator')
        .map(item => ({
          label: `$(${item.icon || 'circle-outline'}) ${item.label}`,
          description: item.shortcut || '',
          detail: item.tooltip,
          item
        }));

      const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: `Actions for "${conversation.title}"`
      });

      if (selected) {
        await this.contextMenuProvider.executeAction(selected.item.action, conversation);
        this.conversationTreeProvider.refresh();
      }
    } catch (error) {
      console.error('Failed to show conversation context menu:', error);
      vscode.window.showErrorMessage('Failed to show context menu');
    }
  }

  private async showMessageContextMenu(message: any, conversation: any): Promise<void> {
    try {
      const menuItems = this.contextMenuProvider.getMessageContextMenu(message, conversation);
      
      const quickPickItems = menuItems
        .filter(item => item.visible && item.group !== 'separator')
        .map(item => ({
          label: `$(${item.icon || 'circle-outline'}) ${item.label}`,
          description: item.shortcut || '',
          detail: item.tooltip,
          item
        }));

      const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: `Actions for message from ${message.sender === 'user' ? 'You' : 'Cursor AI'}`
      });

      if (selected) {
        await this.contextMenuProvider.executeAction(selected.item.action, message, conversation);
        this.conversationTreeProvider.refresh();
      }
    } catch (error) {
      console.error('Failed to show message context menu:', error);
      vscode.window.showErrorMessage('Failed to show context menu');
    }
  }

  private getMessageDetailsHtml(message: any): string {
    const codeChanges = message.codeChanges || [];
    const snapshot = message.snapshot || [];
    
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Message Details</title>
        <style>
          body { 
            font-family: var(--vscode-font-family); 
            padding: 20px; 
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
          }
          .message-header { 
            border-bottom: 1px solid var(--vscode-panel-border); 
            padding-bottom: 15px; 
            margin-bottom: 20px; 
          }
          .message-content { 
            white-space: pre-wrap; 
            margin-bottom: 20px; 
            padding: 15px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            border-radius: 4px;
          }
          .section { 
            margin-top: 20px; 
            padding: 15px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
          }
          .section h3 {
            margin-top: 0;
            color: var(--vscode-textPreformat-foreground);
          }
          .code-change, .snapshot-file { 
            margin-bottom: 10px; 
            padding: 10px; 
            background: var(--vscode-editor-background); 
            border-radius: 4px; 
            border: 1px solid var(--vscode-panel-border);
          }
          .change-type {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 0.8em;
            font-weight: bold;
            margin-right: 8px;
          }
          .change-create { background: var(--vscode-gitDecoration-addedResourceForeground); color: white; }
          .change-modify { background: var(--vscode-gitDecoration-modifiedResourceForeground); color: white; }
          .change-delete { background: var(--vscode-gitDecoration-deletedResourceForeground); color: white; }
          .button-group {
            margin-top: 20px;
            display: flex;
            gap: 10px;
          }
          .button { 
            background: var(--vscode-button-background); 
            color: var(--vscode-button-foreground); 
            border: none; 
            padding: 8px 16px; 
            border-radius: 4px; 
            cursor: pointer; 
            font-size: 14px;
          }
          .button:hover { 
            background: var(--vscode-button-hoverBackground); 
          }
          .button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          .button.secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }
          .file-path {
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
            color: var(--vscode-textLink-foreground);
          }
        </style>
      </head>
      <body>
        <div class="message-header">
          <h2>${message.sender === 'user' ? '👤 User Message' : '🤖 AI Assistant'}</h2>
          <p><strong>Timestamp:</strong> ${new Date(message.timestamp).toLocaleString()}</p>
          <p><strong>Message ID:</strong> ${message.id}</p>
        </div>
        
        <div class="message-content">${this.escapeHtml(message.content)}</div>
        
        ${codeChanges.length > 0 ? `
          <div class="section">
            <h3>Code Changes (${codeChanges.length})</h3>
            ${codeChanges.map((change: any) => `
              <div class="code-change">
                <span class="change-type change-${change.changeType}">${change.changeType.toUpperCase()}</span>
                <span class="file-path">${change.filePath}</span>
                ${change.lineNumbers ? `<div style="margin-top: 5px; font-size: 0.8em; color: var(--vscode-descriptionForeground);">Lines ${change.lineNumbers.start}-${change.lineNumbers.end}</div>` : ''}
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        ${snapshot.length > 0 ? `
          <div class="section">
            <h3>File Snapshot (${snapshot.length} files)</h3>
            ${snapshot.map((file: any) => `
              <div class="snapshot-file">
                <span class="file-path">${file.filePath}</span>
                <div style="margin-top: 5px; font-size: 0.8em; color: var(--vscode-descriptionForeground);">
                  Size: ${file.content.length} chars • Checksum: ${file.checksum.substring(0, 8)}...
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        <div class="button-group">
          <button class="button" onclick="rollback()">🔄 Rollback to this Message</button>
          <button class="button secondary" onclick="copyContent()">📋 Copy Content</button>
          <button class="button secondary" onclick="exportMessage()">💾 Export Message</button>
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          function rollback() {
            vscode.postMessage({ command: 'rollback' });
          }
          
          function copyContent() {
            navigator.clipboard.writeText(\`${this.escapeJs(message.content)}\`);
            vscode.postMessage({ command: 'showInfo', text: 'Message content copied to clipboard' });
          }
          
          function exportMessage() {
            vscode.postMessage({ command: 'export' });
          }
        </script>
      </body>
      </html>
    `;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeJs(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  }

  private async showCodeChangeDiff(codeChange: any, messageId: string): Promise<void> {
    try {
      // Create temporary files for diff comparison
      const beforeUri = vscode.Uri.parse(`untitled:${codeChange.filePath}.before`);
      const afterUri = vscode.Uri.parse(`untitled:${codeChange.filePath}.after`);
      
      // Open diff editor
      await vscode.commands.executeCommand('vscode.diff', 
        beforeUri, 
        afterUri, 
        `${codeChange.filePath} (${codeChange.changeType})`,
        {
          preview: true
        }
      );
      
      // Set content for the diff
      const beforeDoc = await vscode.workspace.openTextDocument(beforeUri);
      const afterDoc = await vscode.workspace.openTextDocument(afterUri);
      
      const beforeEdit = new vscode.WorkspaceEdit();
      const afterEdit = new vscode.WorkspaceEdit();
      
      beforeEdit.insert(beforeUri, new vscode.Position(0, 0), codeChange.beforeContent || '');
      afterEdit.insert(afterUri, new vscode.Position(0, 0), codeChange.afterContent || '');
      
      await vscode.workspace.applyEdit(beforeEdit);
      await vscode.workspace.applyEdit(afterEdit);
      
    } catch (error) {
      console.error(`Failed to show code change diff for message ${messageId}:`, error);
      vscode.window.showErrorMessage('Failed to show code change diff');
    }
  }

  private getEnhancedMessageDetailsHtml(messageHtml: string, message: any): string {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Message Details</title>
        <style>
          body { 
            font-family: var(--vscode-font-family); 
            padding: 20px; 
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            line-height: 1.6;
          }
          .message-container {
            max-width: 800px;
            margin: 0 auto;
          }
          .message-header { 
            border-bottom: 2px solid var(--vscode-panel-border); 
            padding-bottom: 15px; 
            margin-bottom: 20px; 
          }
          .sender-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.9em;
            font-weight: bold;
            margin-bottom: 10px;
          }
          .sender-user {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          .sender-ai {
            background: var(--vscode-textLink-activeForeground);
            color: white;
          }
          .message-content { 
            white-space: pre-wrap; 
            margin-bottom: 20px; 
            padding: 20px;
            background: var(--vscode-textBlockQuote-background);
            border-left: 4px solid var(--vscode-textBlockQuote-border);
            border-radius: 8px;
            font-size: 1.1em;
          }
          .section { 
            margin-top: 25px; 
            padding: 20px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
          }
          .section h3 {
            margin-top: 0;
            margin-bottom: 15px;
            color: var(--vscode-textPreformat-foreground);
            font-size: 1.2em;
          }
          .expandable-section {
            cursor: pointer;
            user-select: none;
          }
          .expandable-section:hover {
            background: var(--vscode-list-hoverBackground);
          }
          .section-content {
            margin-top: 15px;
          }
          .hidden {
            display: none;
          }
          .expand-icon {
            margin-right: 8px;
            transition: transform 0.2s;
          }
          .expand-icon.expanded {
            transform: rotate(90deg);
          }
        </style>
      </head>
      <body>
        <div class="message-container">
          <div class="message-header">
            <div class="sender-badge sender-${message.sender}">
              ${message.sender === 'user' ? '👤 You' : '🤖 Cursor AI'}
            </div>
            <h2>Message Details</h2>
            <p><strong>Timestamp:</strong> ${new Date(message.timestamp).toLocaleString()}</p>
            <p><strong>Message ID:</strong> <code>${message.id}</code></p>
          </div>
          
          ${messageHtml}
        </div>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          function toggleSection(sectionId) {
            const content = document.getElementById(sectionId);
            const icon = document.querySelector(\`[onclick="toggleSection('\${sectionId}')"] .expand-icon\`);
            
            if (content.classList.contains('hidden')) {
              content.classList.remove('hidden');
              icon.classList.add('expanded');
            } else {
              content.classList.add('hidden');
              icon.classList.remove('expanded');
            }
          }
          
          function rollback() {
            vscode.postMessage({ command: 'rollback' });
          }
          
          function copyContent() {
            navigator.clipboard.writeText(\`${this.escapeJs(message.content)}\`);
          }
          
          function exportMessage() {
            vscode.postMessage({ command: 'export' });
          }
        </script>
      </body>
      </html>
    `;
  }

  dispose(): void {
    this.expandManager.dispose();
    this.messageDisplayProvider.dispose();
    this.searchFilterProvider.dispose();
    this.contextMenuProvider.dispose();
    this.conversationTreeProvider.dispose();
    this.conversationTreeView.dispose();
  }
}