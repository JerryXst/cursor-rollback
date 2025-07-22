import * as vscode from 'vscode';
import { RollbackRecoveryManager } from './rollbackRecovery';

export class RecoveryCommands {
    private recoveryManager: RollbackRecoveryManager;

    constructor(context: vscode.ExtensionContext) {
        this.recoveryManager = RollbackRecoveryManager.getInstance(context);
        this.registerCommands(context);
    }

    private registerCommands(context: vscode.ExtensionContext): void {
        // 显示恢复选项命令
        const showRecoveryOptionsCmd = vscode.commands.registerCommand(
            'cursorRollback.showRecoveryOptions',
            async () => {
                await this.showRecoveryOptionsCommand();
            }
        );

        // 创建恢复状态快照命令
        const createRecoveryStateCmd = vscode.commands.registerCommand(
            'cursorRollback.createRecoveryState',
            async () => {
                await this.createRecoveryStateCommand();
            }
        );

        // 查看活跃失败命令
        const viewActiveFailuresCmd = vscode.commands.registerCommand(
            'cursorRollback.viewActiveFailures',
            async () => {
                await this.viewActiveFailuresCommand();
            }
        );

        // 清理旧恢复状态命令
        const cleanupRecoveryStatesCmd = vscode.commands.registerCommand(
            'cursorRollback.cleanupRecoveryStates',
            async () => {
                await this.cleanupRecoveryStatesCommand();
            }
        );

        // 手动触发恢复命令
        const manualRecoveryCmd = vscode.commands.registerCommand(
            'cursorRollback.manualRecovery',
            async (failureId?: string) => {
                await this.manualRecoveryCommand(failureId);
            }
        );

        context.subscriptions.push(
            showRecoveryOptionsCmd,
            createRecoveryStateCmd,
            viewActiveFailuresCmd,
            cleanupRecoveryStatesCmd,
            manualRecoveryCmd
        );
    }

    private async showRecoveryOptionsCommand(): Promise<void> {
        const activeFailures = this.recoveryManager.getActiveFailures();
        
        if (activeFailures.length === 0) {
            vscode.window.showInformationMessage('No active rollback failures found');
            return;
        }

        const options = activeFailures.map(failure => ({
            label: `$(error) ${failure.errorType}`,
            description: `Message: ${failure.messageId}`,
            detail: `${failure.affectedFiles.length} files affected - ${failure.recoveryAttempts} attempts`,
            failure
        }));

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select a failure to recover from'
        });

        if (selected) {
            await this.recoveryManager.showManualRecoveryOptions(selected.failure.id);
        }
    }

    private async createRecoveryStateCommand(): Promise<void> {
        try {
            vscode.window.showInformationMessage('Creating recovery state...');
            
            const stateId = await this.recoveryManager.createRecoveryState();
            
            vscode.window.showInformationMessage(
                `Recovery state created: ${stateId}`,
                'View States'
            ).then(action => {
                if (action === 'View States') {
                    vscode.commands.executeCommand('cursorRollback.viewRecoveryStates');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(
                `Failed to create recovery state: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    private async viewActiveFailuresCommand(): Promise<void> {
        const activeFailures = this.recoveryManager.getActiveFailures();
        
        if (activeFailures.length === 0) {
            vscode.window.showInformationMessage('No active rollback failures');
            return;
        }

        const failureDetails = activeFailures.map(failure => 
            `${failure.id}: ${failure.errorType} (${failure.recoveryAttempts}/${3} attempts)`
        ).join('\n');

        const content = [
            'Active Rollback Failures',
            '========================',
            '',
            ...activeFailures.map(failure => [
                `Failure ID: ${failure.id}`,
                `Error Type: ${failure.errorType}`,
                `Message ID: ${failure.messageId}`,
                `Timestamp: ${new Date(failure.timestamp).toLocaleString()}`,
                `Recovery Attempts: ${failure.recoveryAttempts}/3`,
                `Affected Files: ${failure.affectedFiles.length}`,
                `Error: ${failure.errorMessage}`,
                ''
            ].join('\n'))
        ].join('\n');

        const document = await vscode.workspace.openTextDocument({
            content,
            language: 'plaintext'
        });

        await vscode.window.showTextDocument(document);
    }

    private async cleanupRecoveryStatesCommand(): Promise<void> {
        const confirmed = await vscode.window.showWarningMessage(
            'This will remove recovery states older than 7 days. Continue?',
            'Yes', 'No'
        );

        if (confirmed === 'Yes') {
            try {
                await this.recoveryManager.cleanupOldRecoveryStates();
                vscode.window.showInformationMessage('Recovery states cleaned up successfully');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
            }
        }
    }

    private async manualRecoveryCommand(failureId?: string): Promise<void> {
        if (failureId) {
            await this.recoveryManager.showManualRecoveryOptions(failureId);
            return;
        }

        // 如果没有提供failureId，让用户选择
        await this.showRecoveryOptionsCommand();
    }

    /**
     * 处理回滚失败的入口点
     * 这个方法会被回滚系统调用当检测到失败时
     */
    public async handleRollbackFailure(
        messageId: string,
        error: Error,
        affectedFiles: string[],
        backupId?: string
    ): Promise<void> {
        try {
            // 检测并记录失败
            const failure = await this.recoveryManager.detectRollbackFailure(
                messageId,
                error,
                affectedFiles,
                backupId
            );

            // 显示失败通知
            const action = await vscode.window.showErrorMessage(
                `Rollback failed: ${failure.errorType}`,
                'Auto Recover',
                'Manual Recovery',
                'Dismiss'
            );

            switch (action) {
                case 'Auto Recover':
                    const success = await this.recoveryManager.attemptAutoRecovery(failure.id);
                    if (!success) {
                        vscode.window.showWarningMessage(
                            'Auto recovery failed. Use manual recovery options.',
                            'Manual Recovery'
                        ).then(manualAction => {
                            if (manualAction === 'Manual Recovery') {
                                this.recoveryManager.showManualRecoveryOptions(failure.id);
                            }
                        });
                    }
                    break;
                case 'Manual Recovery':
                    await this.recoveryManager.showManualRecoveryOptions(failure.id);
                    break;
                case 'Dismiss':
                    // 用户选择忽略，不做任何操作
                    break;
            }
        } catch (error) {
            console.error('Failed to handle rollback failure:', error);
            vscode.window.showErrorMessage(
                `Failed to handle rollback failure: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * 获取恢复管理器实例（供其他模块使用）
     */
    public getRecoveryManager(): RollbackRecoveryManager {
        return this.recoveryManager;
    }
}