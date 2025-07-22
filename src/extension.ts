import * as vscode from 'vscode';
import { RecoveryCommands } from './rollback/recoveryCommands';

export async function activate(ctx: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "cursor-rollback" is now active!');
	
	const restoreCmd = 'cursor.agent.restoreCheckpoint';
	const listCmd = 'cursor.agent.listCheckpoints';

	// Initialize recovery system
	const recoveryCommands = new RecoveryCommands(ctx);

	// Now `await` is allowed because `activate` is async
	const checkpoints = await vscode.commands.executeCommand<any[]>(listCmd);

	ctx.subscriptions.push(
		vscode.commands.registerCommand('cursorRollback.restoreCheckpoint', async () => {
			vscode.window.showInformationMessage('Restore checkpoint command triggered!');
			if (!checkpoints?.length) {
				return vscode.window.showWarningMessage('No checkpoints found.');
			}

			const item = await vscode.window.showQuickPick(
				checkpoints.map(c => ({
					label: c.message || `#${c.id}`,
					description: new Date(c.timestamp).toLocaleString(),
					checkpoint: c.id
				})), { placeHolder: 'Select a checkpoint to restore' }
			);

			if (item) {
				try {
					await vscode.commands.executeCommand(restoreCmd, { id: item.checkpoint });
					vscode.window.showInformationMessage('Checkpoint restored!');
				} catch (error) {
					// Handle rollback failure using the recovery system
					await recoveryCommands.handleRollbackFailure(
						item.checkpoint,
						error instanceof Error ? error : new Error('Unknown rollback error'),
						[], // We don't have affected files info from cursor.agent
						undefined // No backup ID available
					);
				}
			}
		}),

		vscode.commands.registerCommand('cursorRollback.rewindChat', async () => {
			vscode.window.showInformationMessage('rewindChat command triggered!');
			try {
				await vscode.commands.executeCommand('cursor.chat.duplicate');
				vscode.window.showInformationMessage('Duplicated chat – continue in the new tab!');
			} catch (error) {
				// Handle chat rewind failure
				await recoveryCommands.handleRollbackFailure(
					'chat_rewind',
					error instanceof Error ? error : new Error('Chat rewind failed'),
					[],
					undefined
				);
			}
		})
	);
}
