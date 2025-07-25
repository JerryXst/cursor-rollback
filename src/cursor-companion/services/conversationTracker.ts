import * as vscode from 'vscode';
import * as path from 'path';
import { IConversationTracker } from './interfaces';
import { Conversation, Message, CodeChange } from '../models';
import { CodeChangeFactory, ConversationFactory, MessageFactory } from '../models/factories';
import { generateUUID } from '../utils/helpers';
import { HeuristicDetector } from './heuristicDetector';

/**
 * Implementation of conversation tracking for Cursor AI interactions
 */
export class ConversationTracker implements IConversationTracker {
  private isTrackingActive = false;
  private fileSystemWatcher?: vscode.FileSystemWatcher;
  private conversationCallbacks: Array<(conversation: Conversation) => void> = [];
  private messageCallbacks: Array<(message: Message) => void> = [];
  private errorCallbacks: Array<(error: Error) => void> = [];

  // File change tracking
  private fileChangeBuffer: Map<string, {
    changeType: 'create' | 'modify' | 'delete';
    content?: string;
    timestamp: number;
  }> = new Map();

  // Active conversation tracking
  private activeConversationId?: string;
  private activeMessageId?: string;
  private fileChangeTimeout?: NodeJS.Timeout;
  private readonly FILE_CHANGE_BUFFER_TIME = 2000; // 2 seconds buffer for grouping changes
  private readonly IGNORED_PATTERNS = [
    /node_modules/,
    /\.git/,
    /\.vscode/,
    /\.DS_Store/,
    /\.kiro\/specs/
  ];

  // Cursor API integration
  private cursorCommandDisposables: vscode.Disposable[] = [];
  private lastCursorActivity: number = 0;
  private readonly CONVERSATION_BOUNDARY_TIME = 300000; // 5 minutes of inactivity marks a new conversation
  private isCursorChatActive = false;

  // Heuristic detection
  private heuristicDetector: HeuristicDetector;

  constructor(private context: vscode.ExtensionContext) {
    this.heuristicDetector = new HeuristicDetector();
  }

  async startTracking(): Promise<void> {
    if (this.isTrackingActive) {
      return;
    }

    try {
      // Set up file system watching for code changes
      this.setupFileSystemWatcher();

      // Set up Cursor API integration
      await this.setupCursorAPIIntegration();

      this.isTrackingActive = true;
      console.log('Cursor Companion: Conversation tracking started');
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Failed to start tracking');
      this.notifyError(err);
      throw err;
    }
  }

  stopTracking(): void {
    if (!this.isTrackingActive) {
      return;
    }

    // Clean up file system watcher
    if (this.fileSystemWatcher) {
      this.fileSystemWatcher.dispose();
      this.fileSystemWatcher = undefined;
    }

    // Clean up Cursor API integration
    this.cleanupCursorAPIIntegration();

    // Clear any pending file change processing
    if (this.fileChangeTimeout) {
      clearTimeout(this.fileChangeTimeout);
      this.fileChangeTimeout = undefined;
    }

    // Reset heuristic detector
    this.heuristicDetector.reset();

    this.isTrackingActive = false;
    console.log('Cursor Companion: Conversation tracking stopped');
  }

  isTracking(): boolean {
    return this.isTrackingActive;
  }

  onNewConversation(callback: (conversation: Conversation) => void): void {
    this.conversationCallbacks.push(callback);
  }

  onNewMessage(callback: (message: Message) => void): void {
    this.messageCallbacks.push(callback);
  }

  onTrackingError(callback: (error: Error) => void): void {
    this.errorCallbacks.push(callback);
  }

  /**
   * Set up file system watcher to monitor workspace file changes
   */
  private setupFileSystemWatcher(): void {
    // Check if we have workspace folders
    if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
      console.warn('Cursor Companion: No workspace folders found, file tracking limited');
      return;
    }

    // Watch for file changes in the workspace
    const pattern = new vscode.RelativePattern(
      vscode.workspace.workspaceFolders[0],
      '**/*'
    );

    // Create a file system watcher with specific ignore patterns
    this.fileSystemWatcher = vscode.workspace.createFileSystemWatcher(pattern);

    // Register event handlers
    this.fileSystemWatcher.onDidChange(this.handleFileChange.bind(this));
    this.fileSystemWatcher.onDidCreate(this.handleFileCreate.bind(this));
    this.fileSystemWatcher.onDidDelete(this.handleFileDelete.bind(this));

    console.log('Cursor Companion: File system watcher initialized');
  }

  /**
   * Handle file change events
   */
  private async handleFileChange(uri: vscode.Uri): Promise<void> {
    try {
      // Skip ignored files
      if (this.shouldIgnoreFile(uri.fsPath)) {
        return;
      }

      // Read the current content of the file
      const content = await this.readFileContent(uri);
      if (content === null) {
        return; // Skip if we couldn't read the file (might be binary)
      }

      // Add to change buffer
      this.fileChangeBuffer.set(uri.fsPath, {
        changeType: 'modify',
        content,
        timestamp: Date.now()
      });

      // Schedule processing of changes
      this.scheduleChangeProcessing();

      console.log(`Cursor Companion: File changed: ${uri.fsPath}`);
    } catch (error) {
      this.notifyError(error instanceof Error ? error : new Error(`File change handling failed for ${uri.fsPath}`));
    }
  }

  /**
   * Handle file creation events
   */
  private async handleFileCreate(uri: vscode.Uri): Promise<void> {
    try {
      // Skip ignored files
      if (this.shouldIgnoreFile(uri.fsPath)) {
        return;
      }

      // Read the content of the newly created file
      const content = await this.readFileContent(uri);
      if (content === null) {
        return; // Skip if we couldn't read the file (might be binary)
      }

      // Add to change buffer
      this.fileChangeBuffer.set(uri.fsPath, {
        changeType: 'create',
        content,
        timestamp: Date.now()
      });

      // Schedule processing of changes
      this.scheduleChangeProcessing();

      console.log(`Cursor Companion: File created: ${uri.fsPath}`);
    } catch (error) {
      this.notifyError(error instanceof Error ? error : new Error(`File creation handling failed for ${uri.fsPath}`));
    }
  }

  /**
   * Handle file deletion events
   */
  private async handleFileDelete(uri: vscode.Uri): Promise<void> {
    try {
      // Skip ignored files
      if (this.shouldIgnoreFile(uri.fsPath)) {
        return;
      }

      // Add to change buffer (we don't have content for deleted files)
      this.fileChangeBuffer.set(uri.fsPath, {
        changeType: 'delete',
        timestamp: Date.now()
      });

      // Schedule processing of changes
      this.scheduleChangeProcessing();

      console.log(`Cursor Companion: File deleted: ${uri.fsPath}`);
    } catch (error) {
      this.notifyError(error instanceof Error ? error : new Error(`File deletion handling failed for ${uri.fsPath}`));
    }
  }

  /**
   * Schedule processing of buffered file changes
   */
  private scheduleChangeProcessing(): void {
    // Clear any existing timeout
    if (this.fileChangeTimeout) {
      clearTimeout(this.fileChangeTimeout);
    }

    // Set a new timeout to process changes after the buffer time
    this.fileChangeTimeout = setTimeout(() => {
      this.processBufferedChanges();
    }, this.FILE_CHANGE_BUFFER_TIME);
  }

  /**
   * Process all buffered file changes
   */
  private async processBufferedChanges(): Promise<void> {
    try {
      // Skip if no changes
      if (this.fileChangeBuffer.size === 0) {
        return;
      }

      console.log(`Cursor Companion: Processing ${this.fileChangeBuffer.size} buffered file changes`);

      // Convert buffered changes to code changes
      const codeChanges: CodeChange[] = [];

      for (const [filePath, change] of this.fileChangeBuffer.entries()) {
        try {
          // Create appropriate code change object based on change type
          switch (change.changeType) {
            case 'create':
              if (change.content) {
                const createChange = CodeChangeFactory.createFile(filePath, change.content);
                codeChanges.push(createChange);
              }
              break;

            case 'modify':
              if (change.content) {
                // For modifications, we need the previous content
                // In a real implementation, we would have a snapshot system
                // For now, we'll just use the current content for both before and after
                const modifyChange = CodeChangeFactory.modifyFile(
                  filePath,
                  change.content, // Ideally this would be the previous content
                  change.content
                );
                codeChanges.push(modifyChange);
              }
              break;

            case 'delete':
              // For deletions, we would need the previous content
              // In a real implementation, we would have a snapshot system
              const deleteChange = CodeChangeFactory.deleteFile(filePath, '');
              codeChanges.push(deleteChange);
              break;
          }
        } catch (error) {
          console.error(`Error processing change for ${filePath}:`, error);
        }
      }

      // Clear the buffer
      this.fileChangeBuffer.clear();

      // If we have code changes, associate them with a conversation/message
      if (codeChanges.length > 0) {
        await this.associateChangesWithConversation(codeChanges);
      }
    } catch (error) {
      this.notifyError(error instanceof Error ? error : new Error('Failed to process buffered changes'));
    }
  }

  /**
   * Associate code changes with an active conversation or create a new one
   * using heuristic detection
   */
  private async associateChangesWithConversation(codeChanges: CodeChange[]): Promise<void> {
    try {
      // Use heuristic detection to analyze changes
      const detectionResult = this.heuristicDetector.analyzeCodeChanges(codeChanges);

      // Log detection results
      console.log('Cursor Companion: Heuristic detection result', {
        isAiGenerated: detectionResult.isAiGenerated,
        confidence: detectionResult.confidence,
        conversationBoundary: detectionResult.conversationBoundary,
        hasExtractedMessage: !!detectionResult.extractedMessage
      });

      // Check if we need to create a new conversation based on boundary detection
      let conversationId = this.activeConversationId;
      let messageId = this.activeMessageId;
      let needNewConversation = false;

      // Determine if we need a new conversation
      if (!conversationId ||
        (detectionResult.conversationBoundary && detectionResult.conversationBoundary.isNewConversation)) {
        needNewConversation = true;
      }

      // Create a new conversation if needed
      if (needNewConversation) {
        // Generate a title based on detection
        let title = `Code changes at ${new Date().toLocaleString()}`;
        if (detectionResult.isAiGenerated) {
          title = `AI-assisted changes at ${new Date().toLocaleString()}`;
        }

        // Generate initial message content
        let initialMessage = 'Automatic detection of code changes';
        if (detectionResult.conversationBoundary) {
          initialMessage = `New conversation: ${detectionResult.conversationBoundary.reason}`;
        }

        // Create conversation with initial message
        const { conversation, message } = ConversationFactory.createWithMessage({
          title,
          initialMessage
        });

        conversationId = conversation.id;
        messageId = message.id;

        // Notify about new conversation
        this.notifyNewConversation(conversation);

        // Notify about new message
        this.notifyNewMessage(message);

        // Set as active conversation
        this.activeConversationId = conversationId;
        this.activeMessageId = messageId;

        console.log(`Cursor Companion: Created new conversation ${conversationId}`);
      }

      // Create a message for the code changes
      let messageContent = `Detected ${codeChanges.length} file changes`;

      // Use extracted message content if available
      if (detectionResult.extractedMessage) {
        messageContent = detectionResult.extractedMessage.content;
      }

      // Create appropriate message based on detection
      let message: Message;
      if (detectionResult.isAiGenerated) {
        // Create as AI message if likely AI-generated
        message = MessageFactory.createAiMessage(
          conversationId!,
          messageContent,
          codeChanges
        );
      } else {
        // Create as user message if likely manual changes
        message = MessageFactory.createUserMessage(
          conversationId!,
          messageContent,
          codeChanges
        );
      }

      // Add AI confidence to metadata
      if (!message.metadata) {
        message.metadata = {};
      }
      message.metadata.confidence = detectionResult.confidence;

      // Update active message ID
      this.activeMessageId = message.id;

      // Notify about new message
      this.notifyNewMessage(message);

      console.log(`Cursor Companion: Associated ${codeChanges.length} changes with conversation ${conversationId}`);
    } catch (error) {
      this.notifyError(error instanceof Error ? error : new Error('Failed to associate changes with conversation'));
    }
  }

  /**
   * Check if a file should be ignored based on patterns
   */
  private shouldIgnoreFile(filePath: string): boolean {
    // Check against ignored patterns
    for (const pattern of this.IGNORED_PATTERNS) {
      if (pattern.test(filePath)) {
        return true;
      }
    }

    // Skip very large files and binary files
    const extension = path.extname(filePath).toLowerCase();
    const binaryExtensions = ['.exe', '.dll', '.so', '.dylib', '.bin', '.dat', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.tar', '.gz'];

    if (binaryExtensions.includes(extension)) {
      return true;
    }

    return false;
  }

  /**
   * Read file content safely
   */
  private async readFileContent(uri: vscode.Uri): Promise<string | null> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      return document.getText();
    } catch (error) {
      console.warn(`Could not read file ${uri.fsPath}:`, error);
      return null;
    }
  }

  /**
   * Notify about a new conversation
   */
  private notifyNewConversation(conversation: Conversation): void {
    this.conversationCallbacks.forEach(callback => {
      try {
        callback(conversation);
      } catch (error) {
        console.error('Error in conversation callback:', error);
      }
    });
  }

  /**
   * Notify about a new message
   */
  private notifyNewMessage(message: Message): void {
    this.messageCallbacks.forEach(callback => {
      try {
        callback(message);
      } catch (error) {
        console.error('Error in message callback:', error);
      }
    });
  }

  /**
   * Notify about an error
   */
  private notifyError(error: Error): void {
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (callbackError) {
        console.error('Error in tracking error callback:', callbackError);
      }
    });
  }

  /**
   * Set up integration with Cursor API commands and events
   */
  private async setupCursorAPIIntegration(): Promise<void> {
    try {
      // Register command listeners for Cursor API events
      this.registerCursorCommandListeners();

      // Check if Cursor commands are available
      const cursorCommandsAvailable = await this.checkCursorCommandsAvailability();

      if (!cursorCommandsAvailable) {
        console.warn('Cursor Companion: Cursor API commands not available, some features may be limited');
      } else {
        console.log('Cursor Companion: Successfully integrated with Cursor API');
      }

      // Set up window state change detection for chat panel
      this.setupChatPanelDetection();

    } catch (error) {
      console.error('Failed to set up Cursor API integration:', error);
      this.notifyError(error instanceof Error ? error : new Error('Failed to set up Cursor API integration'));
    }
  }

  /**
   * Clean up Cursor API integration
   */
  private cleanupCursorAPIIntegration(): void {
    // Dispose all command listeners
    this.cursorCommandDisposables.forEach(disposable => {
      disposable.dispose();
    });
    this.cursorCommandDisposables = [];

    console.log('Cursor Companion: Cursor API integration cleaned up');
  }

  /**
   * Check if Cursor commands are available in the current environment
   */
  private async checkCursorCommandsAvailability(): Promise<boolean> {
    try {
      // Get all available commands
      const allCommands = await vscode.commands.getCommands();

      // Check for essential Cursor commands
      const requiredCommands = [
        'cursor.agent.listCheckpoints',
        'cursor.agent.restoreCheckpoint',
        'cursor.chat.duplicate',
        'cursor.chat.new'
      ];

      const availableCommands = requiredCommands.filter(cmd => allCommands.includes(cmd));

      return availableCommands.length === requiredCommands.length;
    } catch (error) {
      console.error('Error checking Cursor commands availability:', error);
      return false;
    }
  }

  /**
   * Register listeners for Cursor-related commands
   */
  private registerCursorCommandListeners(): void {
    // Listen for cursor.agent command executions
    const agentCommandListener = vscode.commands.registerCommand('_internal.cursorCompanion.agentCommandExecuted',
      (command: string, args: any) => {
        this.handleCursorAgentCommand(command, args);
      }
    );
    this.cursorCommandDisposables.push(agentCommandListener);

    // Listen for cursor.chat command executions
    const chatCommandListener = vscode.commands.registerCommand('_internal.cursorCompanion.chatCommandExecuted',
      (command: string, args: any) => {
        this.handleCursorChatCommand(command, args);
      }
    );
    this.cursorCommandDisposables.push(chatCommandListener);

    // Override cursor.agent.restoreCheckpoint to track rollbacks
    const originalRestoreCommand = vscode.commands.registerCommand('_cursor.agent.restoreCheckpoint.original',
      async (args: any) => {
        return vscode.commands.executeCommand('cursor.agent.restoreCheckpoint', args);
      }
    );
    this.cursorCommandDisposables.push(originalRestoreCommand);

    // Create our interceptor for the restore command
    const interceptRestoreCommand = vscode.commands.registerCommand('cursor.agent.restoreCheckpoint',
      async (args: any) => {
        // Track the restore action
        this.trackCheckpointRestore(args);

        // Execute the original command
        return vscode.commands.executeCommand('_cursor.agent.restoreCheckpoint.original', args);
      }
    );
    this.cursorCommandDisposables.push(interceptRestoreCommand);

    console.log('Cursor Companion: Registered Cursor command listeners');
  }

  /**
   * Set up detection for Cursor chat panel state
   */
  private setupChatPanelDetection(): void {
    // Listen for window state changes to detect when chat panel is opened/closed
    const windowStateListener = vscode.window.onDidChangeWindowState(windowState => {
      // This is a heuristic approach - we can't directly detect the chat panel
      // but we can monitor for window focus changes that might indicate chat activity
      this.checkForChatPanelActivity();
    });
    this.cursorCommandDisposables.push(windowStateListener);

    // Also listen for editor changes as a signal of potential chat activity
    const editorChangeListener = vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) {
        this.checkForChatPanelActivity();
      }
    });
    this.cursorCommandDisposables.push(editorChangeListener);

    console.log('Cursor Companion: Set up chat panel detection');
  }

  /**
   * Handle Cursor agent commands
   */
  private handleCursorAgentCommand(command: string, args: any): void {
    try {
      console.log(`Cursor Companion: Detected cursor.agent command: ${command}`, args);

      // Update last activity timestamp
      this.lastCursorActivity = Date.now();

      // Handle specific commands
      switch (command) {
        case 'cursor.agent.listCheckpoints':
          // This is just a query, no need to track
          break;

        case 'cursor.agent.restoreCheckpoint':
          // Already handled by our command interceptor
          break;

        case 'cursor.agent.createCheckpoint':
          this.trackCheckpointCreation(args);
          break;

        default:
          // For any other agent commands, check if we need to create a new conversation
          this.checkConversationBoundary();
          break;
      }
    } catch (error) {
      console.error('Error handling Cursor agent command:', error);
    }
  }

  /**
   * Handle Cursor chat commands
   */
  private handleCursorChatCommand(command: string, args: any): void {
    try {
      console.log(`Cursor Companion: Detected cursor.chat command: ${command}`, args);

      // Update last activity timestamp
      this.lastCursorActivity = Date.now();

      // Handle specific commands
      switch (command) {
        case 'cursor.chat.new':
          // New chat started
          this.handleNewChat();
          break;

        case 'cursor.chat.duplicate':
          // Chat duplicated/forked
          this.handleChatDuplicate();
          break;

        case 'cursor.chat.submit':
          // User submitted a message
          this.handleChatMessage(args?.message, 'user');
          break;

        case 'cursor.chat.response':
          // AI responded with a message
          this.handleChatMessage(args?.message, 'ai');
          break;

        default:
          // For any other chat commands, check if we need to create a new conversation
          this.checkConversationBoundary();
          break;
      }
    } catch (error) {
      console.error('Error handling Cursor chat command:', error);
    }
  }

  /**
   * Track checkpoint creation
   */
  private trackCheckpointCreation(args: any): void {
    try {
      const checkpointId = args?.id;
      const checkpointMessage = args?.message || 'Checkpoint created';

      console.log(`Cursor Companion: Checkpoint created: ${checkpointId} - ${checkpointMessage}`);

      // If we have an active conversation, associate this checkpoint with it
      if (this.activeConversationId && this.activeMessageId) {
        // In a real implementation, we would store this association
        // For now, we'll just log it
        console.log(`Cursor Companion: Associated checkpoint ${checkpointId} with conversation ${this.activeConversationId}, message ${this.activeMessageId}`);
      }
    } catch (error) {
      console.error('Error tracking checkpoint creation:', error);
    }
  }

  /**
   * Track checkpoint restore
   */
  private trackCheckpointRestore(args: any): void {
    try {
      const checkpointId = args?.id;

      console.log(`Cursor Companion: Restoring checkpoint: ${checkpointId}`);

      // In a real implementation, we would look up which conversation/message this checkpoint
      // is associated with and create a new message in that conversation about the restore

      // For now, we'll create a new AI message in the active conversation if one exists
      if (this.activeConversationId) {
        const aiMessage = MessageFactory.createAiMessage(
          this.activeConversationId,
          `Restored to checkpoint ${checkpointId}`,
          [] // No code changes directly associated with this message
        );

        // Update active message ID
        this.activeMessageId = aiMessage.id;

        // Notify about new message
        this.notifyNewMessage(aiMessage);
      }
    } catch (error) {
      console.error('Error tracking checkpoint restore:', error);
    }
  }

  /**
   * Handle new chat creation
   */
  private handleNewChat(): void {
    try {
      // Create a new conversation
      const { conversation, message } = ConversationFactory.createWithMessage({
        title: `Chat started at ${new Date().toLocaleString()}`,
        initialMessage: 'New Cursor chat started'
      });

      // Set as active conversation
      this.activeConversationId = conversation.id;
      this.activeMessageId = message.id;

      // Notify about new conversation
      this.notifyNewConversation(conversation);

      // Notify about new message
      this.notifyNewMessage(message);

      // Set chat active flag
      this.isCursorChatActive = true;

      console.log(`Cursor Companion: New chat started, created conversation ${conversation.id}`);
    } catch (error) {
      console.error('Error handling new chat:', error);
    }
  }

  /**
   * Handle chat duplication/forking
   */
  private handleChatDuplicate(): void {
    try {
      // If we have an active conversation, create a new one based on it
      if (this.activeConversationId) {
        // In a real implementation, we would copy the conversation history
        // For now, we'll just create a new conversation
        const { conversation, message } = ConversationFactory.createWithMessage({
          title: `Chat forked at ${new Date().toLocaleString()}`,
          initialMessage: 'Forked from previous chat'
        });

        // Set as active conversation
        this.activeConversationId = conversation.id;
        this.activeMessageId = message.id;

        // Notify about new conversation
        this.notifyNewConversation(conversation);

        // Notify about new message
        this.notifyNewMessage(message);

        console.log(`Cursor Companion: Chat duplicated, created conversation ${conversation.id}`);
      } else {
        // If no active conversation, treat as new chat
        this.handleNewChat();
      }
    } catch (error) {
      console.error('Error handling chat duplicate:', error);
    }
  }

  /**
   * Handle chat message (user or AI)
   */
  private handleChatMessage(messageContent: string, sender: 'user' | 'ai'): void {
    try {
      // If no message content, skip
      if (!messageContent) {
        return;
      }

      // Check if we need to create a new conversation
      if (!this.activeConversationId) {
        this.handleNewChat();
      }

      // Create a new message in the active conversation
      let message: Message;

      if (sender === 'user') {
        message = MessageFactory.createUserMessage(
          this.activeConversationId!,
          messageContent,
          [] // We'll associate code changes separately via file system watcher
        );
      } else {
        message = MessageFactory.createAiMessage(
          this.activeConversationId!,
          messageContent,
          [] // We'll associate code changes separately via file system watcher
        );
      }

      // Update active message ID
      this.activeMessageId = message.id;

      // Notify about new message
      this.notifyNewMessage(message);

      console.log(`Cursor Companion: ${sender} message in conversation ${this.activeConversationId}`);
    } catch (error) {
      console.error('Error handling chat message:', error);
    }
  }

  /**
   * Check for chat panel activity using heuristics
   */
  private checkForChatPanelActivity(): void {
    try {
      // This is a heuristic approach since we can't directly detect the chat panel
      // We'll check for editor changes and window focus changes

      // Update last activity timestamp
      this.lastCursorActivity = Date.now();

      // Check if we need to create a new conversation based on time boundary
      this.checkConversationBoundary();
    } catch (error) {
      console.error('Error checking for chat panel activity:', error);
    }
  }

  /**
   * Check if we need to create a new conversation based on time boundary
   */
  private checkConversationBoundary(): void {
    try {
      // If no active conversation, nothing to do
      if (!this.activeConversationId) {
        return;
      }

      // Check if enough time has passed since last activity
      const timeSinceLastActivity = Date.now() - this.lastCursorActivity;

      if (timeSinceLastActivity > this.CONVERSATION_BOUNDARY_TIME) {
        console.log(`Cursor Companion: Conversation boundary detected (${timeSinceLastActivity}ms since last activity)`);

        // Clear active conversation - next activity will create a new one
        this.activeConversationId = undefined;
        this.activeMessageId = undefined;
      }
    } catch (error) {
      console.error('Error checking conversation boundary:', error);
    }
  }
}