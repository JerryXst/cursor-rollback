/**
 * Search and filter provider for conversation management
 * Handles search input, real-time filtering, and search result highlighting
 */

import * as vscode from 'vscode';
import { Conversation, Message, ConversationFilter } from '../models';
import { IDataStorage } from '../services/interfaces';

/**
 * Search filter options
 */
export interface SearchFilterOptions {
  query?: string;
  status?: 'all' | 'active' | 'archived';
  dateRange?: {
    start: Date;
    end: Date;
  };
  tags?: string[];
  sender?: 'all' | 'user' | 'ai';
  hasCodeChanges?: boolean;
  caseSensitive?: boolean;
}

/**
 * Search result item
 */
export interface SearchResult {
  conversation: Conversation;
  message?: Message;
  matchType: 'title' | 'content' | 'tag';
  matchText: string;
  highlightedText: string;
  score: number;
}

/**
 * Search history item
 */
export interface SearchHistoryItem {
  query: string;
  timestamp: number;
  resultCount: number;
}

/**
 * Search suggestions
 */
export interface SearchSuggestion {
  text: string;
  type: 'history' | 'tag' | 'keyword';
  frequency?: number;
}

/**
 * Provides search and filtering functionality for conversations
 */
export class SearchFilterProvider {
  private currentFilter: SearchFilterOptions = {};
  private searchHistory: SearchHistoryItem[] = [];
  private readonly maxHistoryItems = 50;
  private readonly maxSuggestions = 10;
  
  // Debounce timer for search
  private searchDebounceTimer?: NodeJS.Timeout;
  private readonly searchDebounceDelay = 300; // 300ms
  
  // Search callbacks
  private searchCallbacks: Array<(results: SearchResult[]) => void> = [];
  private filterCallbacks: Array<(filter: SearchFilterOptions) => void> = [];

  constructor(
    private context: vscode.ExtensionContext,
    private dataStorage: IDataStorage
  ) {
    this.loadSearchHistory();
  }

  /**
   * Perform search with enhanced debouncing and cancellation
   */
  search(query: string, options: Partial<SearchFilterOptions> = {}): void {
    // Clear existing timer
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }

    // Cancel any ongoing search
    this.cancelCurrentSearch();

    // Set new timer with adaptive delay based on query length
    const delay = this.calculateSearchDelay(query);
    
    this.searchDebounceTimer = setTimeout(async () => {
      await this.performSearch(query, options);
    }, delay);
  }

  /**
   * Calculate adaptive search delay based on query characteristics
   */
  private calculateSearchDelay(query: string): number {
    if (!query.trim()) {
      return 0; // No delay for empty queries
    }
    
    if (query.length < 3) {
      return this.searchDebounceDelay * 1.5; // Longer delay for short queries
    }
    
    if (query.length > 20) {
      return this.searchDebounceDelay * 0.5; // Shorter delay for long queries
    }
    
    return this.searchDebounceDelay;
  }

  /**
   * Cancel current search operation
   */
  private currentSearchController?: AbortController;
  
  private cancelCurrentSearch(): void {
    if (this.currentSearchController) {
      this.currentSearchController.abort();
      this.currentSearchController = undefined;
    }
  }

  /**
   * Perform immediate search without debouncing
   */
  async searchImmediate(query: string, options: Partial<SearchFilterOptions> = {}): Promise<SearchResult[]> {
    return await this.performSearch(query, options);
  }

  /**
   * Apply filter to conversations
   */
  async applyFilter(filter: SearchFilterOptions): Promise<void> {
    this.currentFilter = { ...filter };
    
    // Notify filter callbacks
    this.filterCallbacks.forEach(callback => {
      try {
        callback(this.currentFilter);
      } catch (error) {
        console.error('Error in filter callback:', error);
      }
    });
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.currentFilter = {};
    this.applyFilter({});
  }

  /**
   * Get current filter
   */
  getCurrentFilter(): SearchFilterOptions {
    return { ...this.currentFilter };
  }

  /**
   * Get search suggestions based on input
   */
  async getSearchSuggestions(input: string): Promise<SearchSuggestion[]> {
    const suggestions: SearchSuggestion[] = [];
    const inputLower = input.toLowerCase();

    // Add history suggestions
    const historySuggestions = this.searchHistory
      .filter(item => item.query.toLowerCase().includes(inputLower))
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5)
      .map(item => ({
        text: item.query,
        type: 'history' as const,
        frequency: item.resultCount
      }));

    suggestions.push(...historySuggestions);

    // Add tag suggestions
    const tagSuggestions = await this.getTagSuggestions(inputLower);
    suggestions.push(...tagSuggestions);

    // Add keyword suggestions
    const keywordSuggestions = await this.getKeywordSuggestions(inputLower);
    suggestions.push(...keywordSuggestions);

    // Sort by relevance and limit
    return suggestions
      .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
      .slice(0, this.maxSuggestions);
  }

  /**
   * Get search history
   */
  getSearchHistory(): SearchHistoryItem[] {
    return [...this.searchHistory];
  }

  /**
   * Clear search history
   */
  clearSearchHistory(): void {
    this.searchHistory = [];
    this.saveSearchHistory();
  }

  /**
   * Register search result callback
   */
  onSearchResults(callback: (results: SearchResult[]) => void): void {
    this.searchCallbacks.push(callback);
  }

  /**
   * Register filter change callback
   */
  onFilterChange(callback: (filter: SearchFilterOptions) => void): void {
    this.filterCallbacks.push(callback);
  }

  /**
   * Create quick pick for advanced search
   */
  async showAdvancedSearchDialog(): Promise<SearchFilterOptions | undefined> {
    const options: vscode.QuickPickItem[] = [
      {
        label: '$(search) Search in content',
        description: 'Search in message content',
        detail: 'Enter search terms to find in message content'
      },
      {
        label: '$(tag) Filter by tags',
        description: 'Filter conversations by tags',
        detail: 'Select tags to filter conversations'
      },
      {
        label: '$(calendar) Filter by date range',
        description: 'Filter by date range',
        detail: 'Select conversations from specific date range'
      },
      {
        label: '$(person) Filter by sender',
        description: 'Filter by message sender',
        detail: 'Show messages from user or AI only'
      },
      {
        label: '$(archive) Filter by status',
        description: 'Filter by conversation status',
        detail: 'Show active or archived conversations'
      },
      {
        label: '$(code) Has code changes',
        description: 'Show only messages with code changes',
        detail: 'Filter messages that contain code modifications'
      }
    ];

    const selected = await vscode.window.showQuickPick(options, {
      placeHolder: 'Select search/filter option',
      canPickMany: false
    });

    if (!selected) {
      return undefined;
    }

    // Handle different filter types
    switch (selected.label) {
      case '$(search) Search in content':
        return await this.handleContentSearch();
      case '$(tag) Filter by tags':
        return await this.handleTagFilter();
      case '$(calendar) Filter by date range':
        return await this.handleDateRangeFilter();
      case '$(person) Filter by sender':
        return await this.handleSenderFilter();
      case '$(archive) Filter by status':
        return await this.handleStatusFilter();
      case '$(code) Has code changes':
        return { hasCodeChanges: true };
      default:
        return undefined;
    }
  }

  /**
   * Export search results
   */
  async exportSearchResults(results: SearchResult[]): Promise<void> {
    try {
      const content = this.formatSearchResultsForExport(results);
      
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`search-results-${Date.now()}.md`),
        filters: {
          'Markdown': ['md'],
          'Text': ['txt'],
          'All Files': ['*']
        }
      });

      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        vscode.window.showInformationMessage(`Search results exported to ${uri.fsPath}`);
      }
    } catch (error) {
      console.error('Failed to export search results:', error);
      vscode.window.showErrorMessage('Failed to export search results');
    }
  }

  // Private methods

  /**
   * Perform the actual search with cancellation support and performance optimizations
   */
  private async performSearch(query: string, options: Partial<SearchFilterOptions>): Promise<SearchResult[]> {
    // Create new abort controller for this search
    this.currentSearchController = new AbortController();
    const signal = this.currentSearchController.signal;

    try {
      if (!query.trim()) {
        return [];
      }

      const searchOptions: SearchFilterOptions = {
        ...this.currentFilter,
        ...options,
        query: query.trim()
      };

      // Check if search was cancelled
      if (signal.aborted) {
        return [];
      }

      // Get conversations with potential performance optimization
      const conversations = await this.getConversationsForSearch(searchOptions, signal);
      
      if (signal.aborted) {
        return [];
      }

      const results: SearchResult[] = [];
      const batchSize = 10; // Process conversations in batches to avoid blocking

      // Process conversations in batches to avoid blocking the UI
      for (let i = 0; i < conversations.length; i += batchSize) {
        if (signal.aborted) {
          return [];
        }

        const batch = conversations.slice(i, i + batchSize);
        const batchResults = await this.searchConversationBatch(batch, query, searchOptions, signal);
        results.push(...batchResults);

        // Yield control to prevent blocking
        if (i + batchSize < conversations.length) {
          await new Promise(resolve => setTimeout(resolve, 1));
        }
      }

      if (signal.aborted) {
        return [];
      }

      // Sort results by score
      results.sort((a, b) => b.score - a.score);

      // Limit results to prevent UI overload
      const maxResults = 100;
      const limitedResults = results.slice(0, maxResults);

      // Add to search history
      this.addToSearchHistory(query, limitedResults.length);

      // Notify callbacks
      this.searchCallbacks.forEach(callback => {
        try {
          callback(limitedResults);
        } catch (error) {
          console.error('Error in search callback:', error);
        }
      });

      return limitedResults;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Search was cancelled, return empty results
        return [];
      }
      
      console.error('Search failed:', error);
      vscode.window.showErrorMessage('Search failed');
      return [];
    } finally {
      this.currentSearchController = undefined;
    }
  }

  /**
   * Get conversations for search with potential performance optimization
   */
  private async getConversationsForSearch(
    searchOptions: SearchFilterOptions, 
    signal: AbortSignal
  ): Promise<Conversation[]> {
    // Check if we can use performance manager for optimized loading
    const performanceManager = (this.dataStorage as any).performanceManager;
    
    if (performanceManager && typeof performanceManager.getConversationsPaginated === 'function') {
      // Use paginated loading for better performance
      const conversations: Conversation[] = [];
      let page = 0;
      let hasMore = true;
      
      while (hasMore && !signal.aborted) {
        const result = await performanceManager.getConversationsPaginated(page, 50, {
          status: searchOptions.status,
          dateRange: searchOptions.dateRange ? {
            start: searchOptions.dateRange.start.getTime(),
            end: searchOptions.dateRange.end.getTime()
          } : undefined,
          tags: searchOptions.tags
        });
        
        conversations.push(...result.items);
        hasMore = result.hasMore;
        page++;
        
        // Limit total conversations to prevent memory issues
        if (conversations.length > 1000) {
          break;
        }
      }
      
      return conversations;
    } else {
      // Fallback to regular loading
      return await this.dataStorage.getConversations({
        status: searchOptions.status,
        dateRange: searchOptions.dateRange ? {
          start: searchOptions.dateRange.start.getTime(),
          end: searchOptions.dateRange.end.getTime()
        } : undefined,
        tags: searchOptions.tags
      });
    }
  }

  /**
   * Search a batch of conversations
   */
  private async searchConversationBatch(
    conversations: Conversation[],
    query: string,
    searchOptions: SearchFilterOptions,
    signal: AbortSignal
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const conversation of conversations) {
      if (signal.aborted) {
        break;
      }

      // Apply filters
      if (!this.conversationMatchesFilters(conversation, searchOptions)) {
        continue;
      }

      // Search in conversation title
      const titleMatch = this.searchInText(conversation.title, query, searchOptions.caseSensitive);
      if (titleMatch) {
        results.push({
          conversation,
          matchType: 'title',
          matchText: conversation.title,
          highlightedText: titleMatch.highlighted,
          score: titleMatch.score
        });
      }

      // Search in conversation tags
      if (conversation.metadata?.tags) {
        for (const tag of conversation.metadata.tags) {
          const tagMatch = this.searchInText(tag, query, searchOptions.caseSensitive);
          if (tagMatch) {
            results.push({
              conversation,
              matchType: 'tag',
              matchText: tag,
              highlightedText: tagMatch.highlighted,
              score: tagMatch.score * 0.8 // Lower score for tag matches
            });
          }
        }
      }

      // Search in messages (with lazy loading if available)
      try {
        const messageResults = await this.searchMessagesInConversation(
          conversation, 
          query, 
          searchOptions, 
          signal
        );
        results.push(...messageResults);
      } catch (error) {
        console.warn(`Failed to search messages in conversation ${conversation.id}:`, error);
      }
    }

    return results;
  }

  /**
   * Check if conversation matches filters
   */
  private conversationMatchesFilters(conversation: Conversation, searchOptions: SearchFilterOptions): boolean {
    // Apply status filter
    if (searchOptions.status && searchOptions.status !== 'all' && conversation.status !== searchOptions.status) {
      return false;
    }

    // Apply date range filter
    if (searchOptions.dateRange) {
      const conversationDate = new Date(conversation.timestamp);
      if (conversationDate < searchOptions.dateRange.start || conversationDate > searchOptions.dateRange.end) {
        return false;
      }
    }

    // Apply tag filter
    if (searchOptions.tags && searchOptions.tags.length > 0) {
      const conversationTags = conversation.metadata?.tags || [];
      if (!searchOptions.tags.some(tag => conversationTags.includes(tag))) {
        return false;
      }
    }

    return true;
  }

  /**
   * Search messages in a conversation with performance optimization
   */
  private async searchMessagesInConversation(
    conversation: Conversation,
    query: string,
    searchOptions: SearchFilterOptions,
    signal: AbortSignal
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    
    // Check if we can use performance manager for lazy loading
    const performanceManager = (this.dataStorage as any).performanceManager;
    
    if (performanceManager && typeof performanceManager.getMessagesLazy === 'function') {
      // Use lazy loading to avoid loading all messages at once
      let offset = 0;
      const limit = 20;
      let hasMore = true;
      
      while (hasMore && !signal.aborted) {
        const result = await performanceManager.getMessagesLazy(conversation.id, offset, limit);
        
        for (const message of result.items) {
          if (signal.aborted) {
            break;
          }

          if (this.messageMatchesFilters(message, searchOptions)) {
            const contentMatch = this.searchInText(message.content, query, searchOptions.caseSensitive);
            if (contentMatch) {
              results.push({
                conversation,
                message,
                matchType: 'content',
                matchText: message.content,
                highlightedText: contentMatch.highlighted,
                score: contentMatch.score * 0.9 // Slightly lower score for content matches
              });
            }
          }
        }
        
        hasMore = result.hasMore;
        offset += limit;
        
        // Limit search depth to prevent excessive loading
        if (offset > 200) {
          break;
        }
      }
    } else {
      // Fallback to regular message loading
      const messages = await this.dataStorage.getMessages(conversation.id);
      
      for (const message of messages) {
        if (signal.aborted) {
          break;
        }

        if (this.messageMatchesFilters(message, searchOptions)) {
          const contentMatch = this.searchInText(message.content, query, searchOptions.caseSensitive);
          if (contentMatch) {
            results.push({
              conversation,
              message,
              matchType: 'content',
              matchText: message.content,
              highlightedText: contentMatch.highlighted,
              score: contentMatch.score * 0.9
            });
          }
        }
      }
    }
    
    return results;
  }

  /**
   * Check if message matches filters
   */
  private messageMatchesFilters(message: Message, searchOptions: SearchFilterOptions): boolean {
    // Apply sender filter
    if (searchOptions.sender && searchOptions.sender !== 'all' && message.sender !== searchOptions.sender) {
      return false;
    }

    // Apply code changes filter
    if (searchOptions.hasCodeChanges && (!message.codeChanges || message.codeChanges.length === 0)) {
      return false;
    }

    return true;
  }

  /**
   * Search for text within a string
   */
  private searchInText(text: string, query: string, caseSensitive = false): { highlighted: string; score: number } | null {
    const searchText = caseSensitive ? text : text.toLowerCase();
    const searchQuery = caseSensitive ? query : query.toLowerCase();

    if (!searchText.includes(searchQuery)) {
      return null;
    }

    // Calculate score based on match position and length
    const index = searchText.indexOf(searchQuery);
    const score = this.calculateMatchScore(text, query, index);

    // Create highlighted text
    const highlighted = this.highlightMatches(text, query, caseSensitive);

    return { highlighted, score };
  }

  /**
   * Calculate match score
   */
  private calculateMatchScore(text: string, query: string, index: number): number {
    let score = 100;

    // Boost score for exact matches
    if (text.toLowerCase() === query.toLowerCase()) {
      score += 50;
    }

    // Boost score for matches at the beginning
    if (index === 0) {
      score += 30;
    } else if (index < 10) {
      score += 20;
    }

    // Boost score for longer queries
    score += query.length * 2;

    // Reduce score based on text length (shorter texts are more relevant)
    score -= Math.floor(text.length / 100);

    return Math.max(score, 1);
  }

  /**
   * Highlight matches in text
   */
  private highlightMatches(text: string, query: string, caseSensitive = false): string {
    if (!query.trim()) {
      return text;
    }

    const flags = caseSensitive ? 'g' : 'gi';
    const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, flags);

    return text.replace(regex, '**$1**'); // Use markdown bold for highlighting
  }

  /**
   * Get tag suggestions
   */
  private async getTagSuggestions(input: string): Promise<SearchSuggestion[]> {
    try {
      const conversations = await this.dataStorage.getConversations();
      const tagCounts = new Map<string, number>();

      // Count tag frequencies
      for (const conversation of conversations) {
        if (conversation.metadata?.tags) {
          for (const tag of conversation.metadata.tags) {
            if (tag.toLowerCase().includes(input)) {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
          }
        }
      }

      // Convert to suggestions
      return Array.from(tagCounts.entries())
        .map(([tag, count]) => ({
          text: tag,
          type: 'tag' as const,
          frequency: count
        }))
        .sort((a, b) => b.frequency! - a.frequency!)
        .slice(0, 5);
    } catch (error) {
      console.warn('Failed to get tag suggestions:', error);
      return [];
    }
  }

  /**
   * Get keyword suggestions
   */
  private async getKeywordSuggestions(input: string): Promise<SearchSuggestion[]> {
    // Common programming keywords that might be useful
    const keywords = [
      'function', 'class', 'interface', 'type', 'const', 'let', 'var',
      'import', 'export', 'async', 'await', 'promise', 'error', 'bug',
      'fix', 'refactor', 'optimize', 'test', 'debug', 'api', 'database',
      'component', 'service', 'util', 'helper', 'config', 'setup'
    ];

    return keywords
      .filter(keyword => keyword.includes(input))
      .map(keyword => ({
        text: keyword,
        type: 'keyword' as const
      }))
      .slice(0, 3);
  }

  /**
   * Handle content search dialog
   */
  private async handleContentSearch(): Promise<SearchFilterOptions | undefined> {
    const query = await vscode.window.showInputBox({
      prompt: 'Enter search terms',
      placeHolder: 'Search in message content...',
      value: this.currentFilter.query || ''
    });

    if (query !== undefined) {
      const caseSensitive = await vscode.window.showQuickPick(
        [
          { label: 'Case insensitive', value: false },
          { label: 'Case sensitive', value: true }
        ],
        { placeHolder: 'Search mode' }
      );

      return {
        query,
        caseSensitive: caseSensitive?.value || false
      };
    }

    return undefined;
  }

  /**
   * Handle tag filter dialog
   */
  private async handleTagFilter(): Promise<SearchFilterOptions | undefined> {
    try {
      // Get all available tags
      const conversations = await this.dataStorage.getConversations();
      const allTags = new Set<string>();

      for (const conversation of conversations) {
        if (conversation.metadata?.tags) {
          conversation.metadata.tags.forEach(tag => allTags.add(tag));
        }
      }

      if (allTags.size === 0) {
        vscode.window.showInformationMessage('No tags found in conversations');
        return undefined;
      }

      const tagItems = Array.from(allTags).map(tag => ({
        label: tag,
        picked: this.currentFilter.tags?.includes(tag) || false
      }));

      const selectedTags = await vscode.window.showQuickPick(tagItems, {
        placeHolder: 'Select tags to filter by',
        canPickMany: true
      });

      if (selectedTags) {
        return {
          tags: selectedTags.map(item => item.label)
        };
      }
    } catch (error) {
      console.error('Failed to handle tag filter:', error);
    }

    return undefined;
  }

  /**
   * Handle date range filter dialog
   */
  private async handleDateRangeFilter(): Promise<SearchFilterOptions | undefined> {
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
      return undefined;
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
      return undefined;
    }

    return {
      dateRange: {
        start: new Date(startDate),
        end: new Date(endDate)
      }
    };
  }

  /**
   * Handle sender filter dialog
   */
  private async handleSenderFilter(): Promise<SearchFilterOptions | undefined> {
    const senderOptions = [
      { label: 'All messages', value: 'all' as const },
      { label: 'User messages only', value: 'user' as const },
      { label: 'AI messages only', value: 'ai' as const }
    ];

    const selected = await vscode.window.showQuickPick(senderOptions, {
      placeHolder: 'Filter by message sender'
    });

    if (selected) {
      return { sender: selected.value };
    }

    return undefined;
  }

  /**
   * Handle status filter dialog
   */
  private async handleStatusFilter(): Promise<SearchFilterOptions | undefined> {
    const statusOptions = [
      { label: 'All conversations', value: 'all' as const },
      { label: 'Active conversations', value: 'active' as const },
      { label: 'Archived conversations', value: 'archived' as const }
    ];

    const selected = await vscode.window.showQuickPick(statusOptions, {
      placeHolder: 'Filter by conversation status'
    });

    if (selected) {
      return { status: selected.value };
    }

    return undefined;
  }

  /**
   * Validate date string
   */
  private isValidDate(dateString: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) {
      return false;
    }

    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Add search to history
   */
  private addToSearchHistory(query: string, resultCount: number): void {
    // Remove existing entry if present
    this.searchHistory = this.searchHistory.filter(item => item.query !== query);

    // Add new entry at the beginning
    this.searchHistory.unshift({
      query,
      timestamp: Date.now(),
      resultCount
    });

    // Limit history size
    if (this.searchHistory.length > this.maxHistoryItems) {
      this.searchHistory = this.searchHistory.slice(0, this.maxHistoryItems);
    }

    // Save to storage
    this.saveSearchHistory();
  }

  /**
   * Load search history from storage
   */
  private loadSearchHistory(): void {
    try {
      const saved = this.context.globalState.get<SearchHistoryItem[]>('searchHistory', []);
      this.searchHistory = saved.filter(item => 
        item.query && typeof item.timestamp === 'number' && typeof item.resultCount === 'number'
      );
    } catch (error) {
      console.warn('Failed to load search history:', error);
      this.searchHistory = [];
    }
  }

  /**
   * Save search history to storage
   */
  private saveSearchHistory(): void {
    try {
      this.context.globalState.update('searchHistory', this.searchHistory);
    } catch (error) {
      console.warn('Failed to save search history:', error);
    }
  }

  /**
   * Format search results for export
   */
  private formatSearchResultsForExport(results: SearchResult[]): string {
    const lines: string[] = [];
    
    lines.push('# Search Results');
    lines.push(`Generated: ${new Date().toLocaleString()}`);
    lines.push(`Total Results: ${results.length}`);
    lines.push('');

    if (this.currentFilter.query) {
      lines.push(`**Search Query:** ${this.currentFilter.query}`);
    }

    if (this.currentFilter.status && this.currentFilter.status !== 'all') {
      lines.push(`**Status Filter:** ${this.currentFilter.status}`);
    }

    if (this.currentFilter.sender && this.currentFilter.sender !== 'all') {
      lines.push(`**Sender Filter:** ${this.currentFilter.sender}`);
    }

    if (this.currentFilter.tags && this.currentFilter.tags.length > 0) {
      lines.push(`**Tag Filter:** ${this.currentFilter.tags.join(', ')}`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');

    // Group results by conversation
    const conversationGroups = new Map<string, SearchResult[]>();
    
    for (const result of results) {
      const convId = result.conversation.id;
      if (!conversationGroups.has(convId)) {
        conversationGroups.set(convId, []);
      }
      conversationGroups.get(convId)!.push(result);
    }

    // Format each conversation group
    for (const [convId, convResults] of conversationGroups) {
      const conversation = convResults[0].conversation;
      
      lines.push(`## ${conversation.title}`);
      lines.push(`**Created:** ${new Date(conversation.timestamp).toLocaleString()}`);
      lines.push(`**Status:** ${conversation.status || 'active'}`);
      
      if (conversation.metadata?.tags && conversation.metadata.tags.length > 0) {
        lines.push(`**Tags:** ${conversation.metadata.tags.join(', ')}`);
      }
      
      lines.push('');

      // Add matches
      for (const result of convResults) {
        lines.push(`### ${result.matchType.charAt(0).toUpperCase() + result.matchType.slice(1)} Match`);
        
        if (result.message) {
          lines.push(`**Sender:** ${result.message.sender === 'user' ? 'You' : 'Cursor AI'}`);
          lines.push(`**Time:** ${new Date(result.message.timestamp).toLocaleString()}`);
        }
        
        lines.push('');
        lines.push(result.highlightedText);
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.searchDebounceTimer) {
      clearTimeout(this.searchDebounceTimer);
    }
    
    // Cancel any ongoing search
    this.cancelCurrentSearch();
    
    this.saveSearchHistory();
    this.searchCallbacks = [];
    this.filterCallbacks = [];
  }
}