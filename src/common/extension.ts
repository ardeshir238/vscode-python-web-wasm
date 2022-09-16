/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
	CancellationToken, commands, debug, DebugAdapterDescriptor, DebugAdapterInlineImplementation, DebugConfiguration,
	DebugSession, ExtensionContext, extensions, ProviderResult, Uri, window, WorkspaceFolder, workspace
} from 'vscode';

import { DebugAdapter } from './debugAdapter';

class DebugConfigurationProvider implements DebugConfigurationProvider {

	constructor(private readonly preloadPromise: Promise<void>) {
	}

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	async resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): Promise<DebugConfiguration | undefined> {
		await this.preloadPromise;
		if (!config.type && !config.request && !config.name) {
			const editor = window.activeTextEditor;
			if (editor && editor.document.languageId === 'python') {
				config.type = 'python-web-wasm';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = false;
			}
		}

		if (!config.program) {
			await window.showInformationMessage('Cannot find a Python file to debug');
			return undefined;
		}

		return config;
	}
}

class DebugAdapterDescriptorFactory implements DebugAdapterDescriptorFactory {
	constructor(private readonly context: ExtensionContext, private readonly preloadPromise: Promise<void>) {
	}
	async createDebugAdapterDescriptor(session: DebugSession): Promise<DebugAdapterDescriptor> {
		await this.preloadPromise;
		return new DebugAdapterInlineImplementation(new DebugAdapter(session, this.context));
	}
}

export function activate(context: ExtensionContext) {
	const preloadPromise = preloadPython();
	context.subscriptions.push(
		commands.registerCommand('vscode-python-web-wasm.debug.runEditorContents', async (resource: Uri) => {
			let targetResource = resource;
			if (!targetResource && window.activeTextEditor) {
				targetResource = window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				await preloadPromise;
				return debug.startDebugging(undefined, {
					type: 'python-web-wasm',
					name: 'Run Python in WASM',
					request: 'launch',
					program: targetResource.fsPath
				},
				{
					noDebug: true
				});
			}
			return false;
		}),
		commands.registerCommand('vscode-python-web-wasm.debug.debugEditorContents', async (resource: Uri) => {
			let targetResource = resource;
			if (!targetResource && window.activeTextEditor) {
				targetResource = window.activeTextEditor.document.uri;
			}
			if (targetResource) {
				await preloadPromise;
				return debug.startDebugging(undefined, {
					type: 'python-web-wasm',
					name: 'Debug Python in WASM',
					request: 'launch',
					program: targetResource.fsPath,
					stopOnEntry: true
				});
			}
			return false;
		}),
		commands.registerCommand('vscode-python-web-wasm.debug.getProgramName', config => {
			return window.showInputBox({
				placeHolder: 'Please enter the name of a markdown file in the workspace folder',
				value: 'app.py'
			});
		})
	);

	const provider = new DebugConfigurationProvider(preloadPromise);
	context.subscriptions.push(debug.registerDebugConfigurationProvider('python-web-wasm', provider));

	const factory = new DebugAdapterDescriptorFactory(context, preloadPromise);
	context.subscriptions.push(debug.registerDebugAdapterDescriptorFactory('python-web-wasm', factory));
}

export function deactivate(): Promise<void> {
	return Promise.reject();
}

async function preloadPython(): Promise<void> {
	try {
		const remoteHub = getRemoteHubExtension();
		if (remoteHub !== undefined) {
			const remoteHubApi = await remoteHub.activate();
			if (remoteHubApi.loadWorkspaceContents !== undefined) {
				const uri = Uri.parse('vscode-vfs://github/dbaeumer/python-3.11.0rc');
				await remoteHubApi.loadWorkspaceContents(uri);
				void workspace.fs.readFile(Uri.joinPath(uri, 'python.wasm'));
			}
		}
	} catch (error) {
		console.log(error);
	}
}

function getRemoteHubExtension() {

	type RemoteHubApiStub = { loadWorkspaceContents?(workspaceUri: Uri): Promise<boolean> };
	const remoteHub = extensions.getExtension<RemoteHubApiStub>('ms-vscode.remote-repositories')
		?? extensions.getExtension<RemoteHubApiStub>('GitHub.remoteHub')
		?? extensions.getExtension<RemoteHubApiStub>('GitHub.remoteHub-insiders');

	return remoteHub;
}