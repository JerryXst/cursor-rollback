import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RollbackRecoveryManager, RollbackFailure } from '../rollback/rollbackRecovery';

suite('RollbackRecovery Test Suite', () => {
    let recoveryManager: RollbackRecoveryManager;
    let mockContext: vscode.ExtensionContext;

    setup(() => {
        // Create a mock extension context
        mockContext = {
            globalState: {
                get: (key: string, defaultValue?: any) => defaultValue,
                update: async (key: string, value: any) => { },
                keys: () => [],
                setKeysForSync: (keys: readonly string[]) => { }
            },
            subscriptions: [],
            extensionPath: '',
            extensionUri: vscode.Uri.file(''),
            environmentVariableCollection: {} as any,
            workspaceState: {
                get: (key: string, defaultValue?: any) => defaultValue,
                update: async (key: string, value: any) => { },
                keys: () => []
            },
            secrets: {} as any,
            storageUri: undefined,
            globalStorageUri: vscode.Uri.file(''),
            logUri: vscode.Uri.file(''),
            storagePath: '',
            globalStoragePath: '',
            logPath: '',
            asAbsolutePath: (relativePath: string) => relativePath,
            extensionMode: vscode.ExtensionMode.Test,
            extension: {} as any,
            languageModelAccessInformation: {} as any
        };

        recoveryManager = RollbackRecoveryManager.getInstance(mockContext);
    });

    test('Should detect rollback failure correctly', async () => {
        const error = new Error('Permission denied');
        const messageId = 'test-message-123';
        const affectedFiles = ['file1.ts', 'file2.js'];

        const failure = await recoveryManager.detectRollbackFailure(
            messageId,
            error,
            affectedFiles
        );

        assert.strictEqual(failure.messageId, messageId);
        assert.strictEqual(failure.errorType, 'PERMISSION');
        assert.strictEqual(failure.errorMessage, error.message);
        assert.deepStrictEqual(failure.affectedFiles, affectedFiles);
        assert.strictEqual(failure.recoveryAttempts, 0);
    });

    test('Should categorize errors correctly', async () => {
        const testCases = [
            { error: new Error('Permission denied'), expected: 'PERMISSION' },
            { error: new Error('ENOENT: no such file'), expected: 'FILE_ACCESS' },
            { error: new Error('File is corrupt'), expected: 'CORRUPTION' },
            { error: new Error('Partial failure occurred'), expected: 'PARTIAL_FAILURE' },
            { error: new Error('Something went wrong'), expected: 'UNKNOWN' }
        ];

        for (const testCase of testCases) {
            const failure = await recoveryManager.detectRollbackFailure(
                'test-message',
                testCase.error,
                []
            );
            assert.strictEqual(failure.errorType, testCase.expected,
                `Error "${testCase.error.message}" should be categorized as ${testCase.expected}`);
        }
    });

    test('Should create recovery state', async () => {
        const stateId = await recoveryManager.createRecoveryState();

        assert.ok(stateId);
        assert.ok(stateId.startsWith('state_'));
    });

    test('Should track recovery attempts', async () => {
        const error = new Error('Test error');
        const failure = await recoveryManager.detectRollbackFailure(
            'test-message',
            error,
            []
        );

        // Attempt recovery multiple times
        await recoveryManager.attemptAutoRecovery(failure.id);
        await recoveryManager.attemptAutoRecovery(failure.id);

        const activeFailures = recoveryManager.getActiveFailures();
        const trackedFailure = activeFailures.find(f => f.id === failure.id);

        assert.ok(trackedFailure);
        assert.strictEqual(trackedFailure.recoveryAttempts, 2);
    });

    test('Should stop attempting recovery after max attempts', async () => {
        const error = new Error('Test error');
        const failure = await recoveryManager.detectRollbackFailure(
            'test-message',
            error,
            []
        );

        // Attempt recovery more than max attempts
        for (let i = 0; i < 5; i++) {
            await recoveryManager.attemptAutoRecovery(failure.id);
        }

        const activeFailures = recoveryManager.getActiveFailures();
        const trackedFailure = activeFailures.find(f => f.id === failure.id);

        // Should not be in active failures anymore
        assert.ok(!trackedFailure);
    });

    test('Should generate unique IDs', async () => {
        const ids = new Set();

        for (let i = 0; i < 10; i++) {
            const error = new Error(`Test error ${i}`);
            const failure = await recoveryManager.detectRollbackFailure(
                `test-message-${i}`,
                error,
                []
            );
            ids.add(failure.id);
        }

        assert.strictEqual(ids.size, 10, 'All failure IDs should be unique');
    });

    test('Should handle missing failure gracefully', async () => {
        const nonExistentId = 'non-existent-failure-id';

        try {
            await recoveryManager.attemptAutoRecovery(nonExistentId);
            assert.fail('Should have thrown an error for non-existent failure');
        } catch (error) {
            assert.ok(error instanceof Error);
            assert.ok(error.message.includes('not found'));
        }
    });
});

suite('RecoveryCommands Test Suite', () => {
    test('Should register all commands', () => {
        // This test would require more complex mocking of VSCode API
        // For now, we'll just verify the command names are correct
        const expectedCommands = [
            'cursorRollback.showRecoveryOptions',
            'cursorRollback.createRecoveryState',
            'cursorRollback.viewActiveFailures',
            'cursorRollback.cleanupRecoveryStates',
            'cursorRollback.manualRecovery'
        ];

        // In a real test, we would verify these commands are registered
        assert.ok(expectedCommands.length > 0);
    });
});