import * as vscode from 'vscode';
import { resolve } from 'node:path';
import {
  parseAomlFile,
  type Process,
  type LLMClient,
  type LLMCallOptions,
} from '@aoml/core';
import { dispatch, formatTraceAsMarkdown } from './dispatch';

const PARTICIPANT_ID = 'aoml.orchestrator';

export function activate(context: vscode.ExtensionContext) {
  const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, handleChat);
  participant.iconPath = new vscode.ThemeIcon('rocket');

  context.subscriptions.push(participant);
}

export function deactivate() {}

/** Default LLM call timeout in ms — per TSD §9 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * VS Code Language Model API backed LLM client.
 * Injected by @aoml/copilot for local execution inside the VS Code Extension Host.
 * Per TSD §8.1: "Provider Injector: @aoml/copilot injects vscode.lm."
 * Authentication is handled natively by the IDE — zero tokens required.
 */
class VSCodeLLMClient implements LLMClient {
  private readonly timeoutMs: number;

  constructor(timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  async call(options: LLMCallOptions): Promise<string> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM call timed out after ${this.timeoutMs}ms`)), this.timeoutMs)
    );
    return Promise.race([this._call(options), timeout]);
  }

  private async _call(options: LLMCallOptions): Promise<string> {
    const [model] = await vscode.lm.selectChatModels({ family: 'gpt-4o' });
    if (!model) {
      // Fallback to any available model
      const models = await vscode.lm.selectChatModels();
      if (models.length === 0) {
        throw new Error('No language models available');
      }
      return this.callWithModel(models[0], options);
    }
    return this.callWithModel(model, options);
  }

  private async callWithModel(
    model: vscode.LanguageModelChat,
    options: LLMCallOptions
  ): Promise<string> {
    const messages = [
      vscode.LanguageModelChatMessage.User(options.systemPrompt + '\n\n' + options.userPrompt),
    ];

    const response = await model.sendRequest(messages, {});

    let result = '';
    for await (const chunk of response.text) {
      result += chunk;
    }
    return result;
  }
}

async function handleChat(
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown('❌ No workspace folder open.');
    return;
  }

  const workspacePath = workspaceFolder.uri.fsPath;

  if (request.command === 'list') {
    await handleList(workspacePath, stream);
    return;
  }

  const isDryRun = request.command === 'dry-run' || request.prompt.includes('--dry-run');
  const variables = parseVariables(request.prompt);

  if (isDryRun) {
    const workflowFile = resolveWorkflowFromPrompt(request.prompt, workspacePath);
    if (!workflowFile) {
      stream.markdown(`❌ Could not resolve workflow from: "${request.prompt}"`);
      return;
    }
    const aomlProcess = parseAomlFile(resolve(workspacePath, workflowFile));
    await handleDryRun(aomlProcess, stream);
    return;
  }

  // Delegate to the environment-agnostic dispatch layer, injecting VSCodeLLMClient
  const response = await dispatch({
    intent: request.prompt,
    variables,
    workspacePath,
    llmClient: new VSCodeLLMClient(),
  });

  stream.markdown(response.markdown);
}

/**
 * Dry-run: show the execution plan without calling LLMs.
 */
async function handleDryRun(process: Process, stream: vscode.ChatResponseStream): Promise<void> {
  stream.markdown(`## 📋 Dry Run: ${process.name}\n\n`);
  stream.markdown(`**Type:** ${process.type}\n`);

  if (process.globals && process.globals.vars.length > 0) {
    stream.markdown(`\n**Required globals:**\n`);
    for (const v of process.globals.vars) {
      stream.markdown(`- \`${v.name}\`${v.required ? ' *(required)*' : ''}\n`);
    }
  }

  stream.markdown(`\n**Execution plan:**\n`);
  for (let i = 0; i < process.steps.length; i++) {
    const step = process.steps[i];
    const type = step.type === 'subflow' ? `subflow → ${step.src}` : (step.agent ?? 'unknown');
    stream.markdown(`${i + 1}. **${step.id}** — ${type}\n`);

    if (step.routing) {
      for (const route of step.routing.onStatus) {
        stream.markdown(`   - on \`${route.value}\` → ${route.goto}\n`);
      }
    }
  }
}

/**
 * List available workflows in the workspace.
 */
async function handleList(workspacePath: string, stream: vscode.ChatResponseStream): Promise<void> {
  const workflowsDir = resolve(workspacePath, '.github', 'workflows');
  const fs = await import('node:fs');

  if (!fs.existsSync(workflowsDir)) {
    stream.markdown('No `.github/workflows/` directory found.');
    return;
  }

  stream.markdown('## Available Workflows\n\n');
  const files = fs.readdirSync(workflowsDir, { recursive: true }) as string[];
  const xmlFiles = files.filter((f) => f.endsWith('.xml'));

  for (const file of xmlFiles) {
    stream.markdown(`- \`${file}\`\n`);
  }
}

function resolveWorkflowFromPrompt(prompt: string, workspacePath: string): string | null {
  const fs = require('node:fs') as typeof import('node:fs');

  const pathMatch = prompt.match(/([^\s]+\.xml)/);
  if (pathMatch) {
    const raw = pathMatch[1];
    if (fs.existsSync(resolve(workspacePath, raw))) return raw;
    const prefixed = `.github/workflows/${raw}`;
    if (fs.existsSync(resolve(workspacePath, prefixed))) return prefixed;
    return raw;
  }

  const lower = prompt.toLowerCase();
  const mappings: Record<string, string> = {
    feature: '.github/workflows/feature-dev.xml',
    review: '.github/workflows/code-review.xml',
    qa: '.github/workflows/code-review.xml',
    security: '.github/workflows/modules/security-audit.xml',
  };

  for (const [key, path] of Object.entries(mappings)) {
    if (lower.includes(key)) return path;
  }
  return null;
}

function parseVariables(prompt: string): Record<string, string> {
  const vars: Record<string, string> = {};
  const dashRegex = /--(\w+)\s+([^\s-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = dashRegex.exec(prompt)) !== null) {
    if (match[1] !== 'dry-run') vars[match[1]] = match[2];
  }
  const eqRegex = /(?:^|\s)(\w+)=(\S+)/g;
  while ((match = eqRegex.exec(prompt)) !== null) {
    vars[match[1]] = match[2];
  }
  return vars;
}
