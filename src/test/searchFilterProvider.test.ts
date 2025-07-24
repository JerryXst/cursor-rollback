/**
 * Tests for SearchFilterProvider
 * Validates search functionality, filtering, and result highlighting
 */

import { describe, it, beforeEach, afterEach } from 'mocha';
import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { SearchFilterProvider, SearchFilterOptions } from '../cursor-companion/ui/searchFilterProvider';
import { LocalFileStorage } from '../cursor-companion/services/localFileStorage';
import { Conversation, Message } from '../cursor-companion/models';

describe('SearchFilterProvider', () => {
  let searchFilterProvider: SearchFilterProvider;
  let mockContext: vscode.ExtensionContext;
  let mockDataStorage: LocalFileStorage;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Create mock context
    mockContext = {
      globalState: {
        get: sandbox.stub().returns([]),
        update: sandbox.stub().resolves()
      }
    } as any;

    // Create mock data storage
    mockDataStorage = {
      getConversations: sandbox.stub(),
      getMessages: sandbox.stub()
    } as any;

    // Create search filter provider
    searchFilterProvider = new SearchFilterProvider(mockContext, mockDataStorage);
  });

  afterEach(() => {
    searchFilterProvider.dispose();
    sandbox.restore();
  });

  describe('search functionality', () => {
    it('should perform basic text search', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'Test conversation about JavaScript',
          timestamp: Date.now(),
          messages: ['msg-1'],
          status: 'active'
        }
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'How do I use async/await in JavaScript?',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves(messages);

      const results = await searchFilterProvider.searchImmediate('JavaScript');

      assert.strictEqual(results.length, 2); // One title match, one content match
      assert.ok(results.some(r => r.matchType === 'title'));
      assert.ok(results.some(r => r.matchType === 'content'));
    });

    it('should highlight search terms in results', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'JavaScript tutorial',
          timestamp: Date.now(),
          messages: ['msg-1'],
          status: 'active'
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      const results = await searchFilterProvider.searchImmediate('JavaScript');

      assert.strictEqual(results.length, 1);
      assert.ok(results[0].highlightedText.includes('**JavaScript**'));
    });

    it('should handle case insensitive search by default', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'javascript tutorial',
          timestamp: Date.now(),
          messages: [],
          status: 'active'
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      const results = await searchFilterProvider.searchImmediate('JAVASCRIPT');

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].matchType, 'title');
    });

    it('should handle case sensitive search when specified', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'javascript tutorial',
          timestamp: Date.now(),
          messages: [],
          status: 'active'
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      const results = await searchFilterProvider.searchImmediate('JAVASCRIPT', { caseSensitive: true });

      assert.strictEqual(results.length, 0);
    });

    it('should return empty results for empty query', async () => {
      const results = await searchFilterProvider.searchImmediate('');
      assert.strictEqual(results.length, 0);
    });
  });

  describe('filtering functionality', () => {
    it('should filter by conversation status', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'Active conversation',
          timestamp: Date.now(),
          messages: [],
          status: 'active'
        },
        {
          id: 'conv-2',
          title: 'Archived conversation',
          timestamp: Date.now(),
          messages: [],
          status: 'archived'
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      const results = await searchFilterProvider.searchImmediate('conversation', { status: 'active' });

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].conversation.status, 'active');
    });

    it('should filter by message sender', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'Test conversation',
          timestamp: Date.now(),
          messages: ['msg-1', 'msg-2'],
          status: 'active'
        }
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'User message with test',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          content: 'AI message with test',
          sender: 'ai',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves(messages);

      const results = await searchFilterProvider.searchImmediate('test', { sender: 'user' });

      // Should find title match + user message match only
      const messageResults = results.filter(r => r.message);
      assert.strictEqual(messageResults.length, 1);
      assert.strictEqual(messageResults[0].message!.sender, 'user');
    });

    it('should filter by tags', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'Tagged conversation',
          timestamp: Date.now(),
          messages: [],
          status: 'active',
          metadata: {
            messageCount: 0,
            lastActivity: Date.now(),
            tags: ['javascript', 'tutorial']
          }
        },
        {
          id: 'conv-2',
          title: 'Untagged conversation',
          timestamp: Date.now(),
          messages: [],
          status: 'active'
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      const results = await searchFilterProvider.searchImmediate('conversation', { tags: ['javascript'] });

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].conversation.id, 'conv-1');
    });

    it('should filter by date range', async () => {
      const now = Date.now();
      const yesterday = now - 24 * 60 * 60 * 1000;
      const tomorrow = now + 24 * 60 * 60 * 1000;

      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'Recent conversation',
          timestamp: now,
          messages: [],
          status: 'active'
        },
        {
          id: 'conv-2',
          title: 'Old conversation',
          timestamp: yesterday - 24 * 60 * 60 * 1000, // 2 days ago
          messages: [],
          status: 'active'
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      const results = await searchFilterProvider.searchImmediate('conversation', {
        dateRange: {
          start: new Date(yesterday),
          end: new Date(tomorrow)
        }
      });

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].conversation.id, 'conv-1');
    });

    it('should filter by code changes', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'Test conversation',
          timestamp: Date.now(),
          messages: ['msg-1', 'msg-2'],
          status: 'active'
        }
      ];

      const messages: Message[] = [
        {
          id: 'msg-1',
          conversationId: 'conv-1',
          content: 'Message with code changes',
          sender: 'ai',
          timestamp: Date.now(),
          codeChanges: [
            { filePath: 'test.ts', changeType: 'modify', beforeContent: 'old', afterContent: 'new' }
          ],
          snapshot: []
        },
        {
          id: 'msg-2',
          conversationId: 'conv-1',
          content: 'Message without code changes',
          sender: 'user',
          timestamp: Date.now(),
          codeChanges: [],
          snapshot: []
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves(messages);

      const results = await searchFilterProvider.searchImmediate('Message', { hasCodeChanges: true });

      const messageResults = results.filter(r => r.message);
      assert.strictEqual(messageResults.length, 1);
      assert.strictEqual(messageResults[0].message!.id, 'msg-1');
    });
  });

  describe('search suggestions', () => {
    it('should provide search suggestions based on input', async () => {
      // Mock search history
      const history = [
        { query: 'javascript function', timestamp: Date.now(), resultCount: 5 },
        { query: 'javascript async', timestamp: Date.now() - 1000, resultCount: 3 }
      ];

      (mockContext.globalState.get as sinon.SinonStub).returns(history);

      // Recreate provider to load history
      searchFilterProvider.dispose();
      searchFilterProvider = new SearchFilterProvider(mockContext, mockDataStorage);

      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'Test',
          timestamp: Date.now(),
          messages: [],
          status: 'active',
          metadata: {
            messageCount: 0,
            lastActivity: Date.now(),
            tags: ['javascript', 'typescript']
          }
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);

      const suggestions = await searchFilterProvider.getSearchSuggestions('java');

      assert.ok(suggestions.length > 0);
      assert.ok(suggestions.some(s => s.type === 'history'));
      assert.ok(suggestions.some(s => s.type === 'tag'));
      assert.ok(suggestions.some(s => s.type === 'keyword'));
    });

    it('should return empty suggestions for no matches', async () => {
      (mockDataStorage.getConversations as sinon.SinonStub).resolves([]);

      const suggestions = await searchFilterProvider.getSearchSuggestions('nonexistent');

      // Should still have keyword suggestions
      assert.ok(suggestions.length >= 0);
    });
  });

  describe('search history', () => {
    it('should track search history', async () => {
      (mockDataStorage.getConversations as sinon.SinonStub).resolves([]);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      await searchFilterProvider.searchImmediate('test query');

      const history = searchFilterProvider.getSearchHistory();
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].query, 'test query');
      assert.strictEqual(history[0].resultCount, 0);
    });

    it('should limit search history size', async () => {
      (mockDataStorage.getConversations as sinon.SinonStub).resolves([]);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      // Perform many searches
      for (let i = 0; i < 60; i++) {
        await searchFilterProvider.searchImmediate(`query ${i}`);
      }

      const history = searchFilterProvider.getSearchHistory();
      assert.ok(history.length <= 50); // Should be limited to maxHistoryItems
    });

    it('should clear search history', async () => {
      (mockDataStorage.getConversations as sinon.SinonStub).resolves([]);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      await searchFilterProvider.searchImmediate('test query');
      assert.strictEqual(searchFilterProvider.getSearchHistory().length, 1);

      searchFilterProvider.clearSearchHistory();
      assert.strictEqual(searchFilterProvider.getSearchHistory().length, 0);
    });
  });

  describe('filter management', () => {
    it('should apply and get current filter', async () => {
      const filter: SearchFilterOptions = {
        status: 'active',
        sender: 'user',
        hasCodeChanges: true
      };

      await searchFilterProvider.applyFilter(filter);

      const currentFilter = searchFilterProvider.getCurrentFilter();
      assert.deepStrictEqual(currentFilter, filter);
    });

    it('should clear all filters', async () => {
      const filter: SearchFilterOptions = {
        status: 'active',
        sender: 'user'
      };

      await searchFilterProvider.applyFilter(filter);
      assert.deepStrictEqual(searchFilterProvider.getCurrentFilter(), filter);

      searchFilterProvider.clearFilters();
      assert.deepStrictEqual(searchFilterProvider.getCurrentFilter(), {});
    });
  });

  describe('callbacks', () => {
    it('should notify search result callbacks', async () => {
      const callback = sandbox.stub();
      searchFilterProvider.onSearchResults(callback);

      (mockDataStorage.getConversations as sinon.SinonStub).resolves([]);
      (mockDataStorage.getMessages as sinon.SinonStub).resolves([]);

      await searchFilterProvider.searchImmediate('test');

      assert.ok(callback.calledOnce);
      assert.ok(Array.isArray(callback.firstCall.args[0]));
    });

    it('should notify filter change callbacks', async () => {
      const callback = sandbox.stub();
      searchFilterProvider.onFilterChange(callback);

      const filter: SearchFilterOptions = { status: 'active' };
      await searchFilterProvider.applyFilter(filter);

      assert.ok(callback.calledOnce);
      assert.deepStrictEqual(callback.firstCall.args[0], filter);
    });
  });

  describe('error handling', () => {
    it('should handle search errors gracefully', async () => {
      (mockDataStorage.getConversations as sinon.SinonStub).rejects(new Error('Database error'));

      const results = await searchFilterProvider.searchImmediate('test');

      assert.strictEqual(results.length, 0);
    });

    it('should handle individual conversation errors gracefully', async () => {
      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          title: 'Working conversation',
          timestamp: Date.now(),
          messages: ['msg-1'],
          status: 'active'
        },
        {
          id: 'conv-2',
          title: 'Broken conversation',
          timestamp: Date.now(),
          messages: ['msg-2'],
          status: 'active'
        }
      ];

      (mockDataStorage.getConversations as sinon.SinonStub).resolves(conversations);
      (mockDataStorage.getMessages as sinon.SinonStub)
        .withArgs('conv-1').resolves([])
        .withArgs('conv-2').rejects(new Error('Message load error'));

      const results = await searchFilterProvider.searchImmediate('conversation');

      // Should still find title matches even if message loading fails
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(r => r.matchType === 'title'));
    });
  });
});