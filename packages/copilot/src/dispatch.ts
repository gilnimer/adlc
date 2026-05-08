/**
 * Environment-agnostic dispatch layer for AOML orchestration.
 * No vscode dependency — safe to use in tests and CLI contexts.
 * The VS Code extension injects its own LLMClient via extension.ts.
 */
import { resolve, dirname } from 'node:path';
import {
  parseAomlFile,
  Engine,
  createAdapterExecutor,
  AgentRegistry,
  type LLMClient,
  type LLMCallOptions,
  type SubFlowLoader,
  type EngineState,
  type Process,
} from '@aoml/core';

export interface DispatchOptions {
  intent: string;
  workflowFile?: string;
  variables: Record<string, string>;
  workspacePath: string;
  llmClient?: LLMClient;
}

export interface DispatchResponse {
  state: EngineState;
  markdown: string;
}

/**
 * Resolve and execute an AOML workflow.
 * If no llmClient is provided, a mock executor is used (for tests/dry-run).
 */
export async function dispatch(options: DispatchOptions): Promise<DispatchResponse> {
  const { intent, variables, workspacePath } = options;

  const workflowFile = options.workflowFile ?? resolveWorkflow(intent, workspacePath);
  if (!workflowFile) {
    return {
      state: emptyState('unknown'),
      markdown: `❌ Could not resolve workflow from: "${intent}"\n\nProvide a direct path or use a keyword: \`feature\`, \`review\`, \`qa\`, \`security\``,
    };
  }

  const fullPath = resolve(workspacePath, workflowFile);
  let aomlProcess: Process;
  try {
    aomlProcess = parseAomlFile(fullPath);
  } catch (err) {
    return {
      state: emptyState('unknown'),
      markdown: `❌ Failed to parse workflow \`${workflowFile}\`: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Check required variables
  const missing = getMissingVars(aomlProcess, variables);
  if (missing.length > 0) {
    return {
      state: emptyState(aomlProcess.name),
      markdown: `I need some additional information:\n\n${missing.map((v) => `- **${v}**: _(please provide with \`--${v} <value>\`)_`).join('\n')}`,
    };
  }

  const llmClient = options.llmClient ?? createMockLLMClient();

  const agentsDir = resolve(workspacePath, '.github', 'agents');
  const registry = new AgentRegistry(agentsDir);

  const workerConfigs = new Map<string, import('@aoml/core').AgentConfig>();
  for (const step of aomlProcess.steps) {
    if (step.agent && !workerConfigs.has(step.agent)) {
      try {
        workerConfigs.set(step.agent, registry.resolve(step.agent));
      } catch {
        workerConfigs.set(step.agent, {
          model: 'gpt-4o',
          temperature: 0.5,
          systemPrompt: `You are a ${step.agent} agent.`,
        });
      }
    }
  }

  let adapterConfig: import('@aoml/core').AgentConfig;
  try {
    adapterConfig = registry.resolve('aoml-adapter');
  } catch {
    adapterConfig = {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      systemPrompt: 'Extract status and data from the agent output. Return ONLY valid JSON: {"status": "<status>", "extractedData": "<data>"}',
    };
  }

  const executor = createAdapterExecutor(llmClient, workerConfigs, adapterConfig);

  const subFlowLoader: SubFlowLoader = (src) => {
    return parseAomlFile(resolve(dirname(fullPath), src));
  };

  const engine = new Engine({
    process: aomlProcess,
    variables,
    stepExecutor: executor,
    subFlowLoader,
  });

  const state = await engine.run();
  return { state, markdown: formatTraceAsMarkdown(state) };
}

/**
 * Format engine state as a Markdown summary.
 */
export function formatTraceAsMarkdown(state: EngineState): string {
  const lines: string[] = [`## 🔄 ${state.processName}`, ''];

  for (const entry of state.executionTrace) {
    const icon =
      entry.status === 'success' || entry.status === 'approve'
        ? '✅'
        : entry.status === 'reject' || entry.status === 'fail'
          ? '❌'
          : '⚠️';
    lines.push(`${icon} **${entry.stepId}** (${entry.agent}) — \`${entry.status}\` _${entry.latencyMs}ms_`);
  }

  const totalMs = state.executionTrace.reduce((s, e) => s + e.latencyMs, 0);
  lines.push('', `**Total:** ${totalMs}ms`);
  return lines.join('\n');
}

function resolveWorkflow(intent: string, workspacePath: string): string | null {
  const fs = require('node:fs') as typeof import('node:fs');
  const lower = intent.toLowerCase();

  // Direct .xml path in the intent
  const pathMatch = intent.match(/([^\s]+\.xml)/);
  if (pathMatch) {
    const raw = pathMatch[1];
    if (fs.existsSync(resolve(workspacePath, raw))) return raw;
    const prefixed = `.github/workflows/${raw}`;
    if (fs.existsSync(resolve(workspacePath, prefixed))) return prefixed;
    return raw;
  }

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

function getMissingVars(process: Process, provided: Record<string, string>): string[] {
  if (!process.globals) return [];
  return process.globals.vars
    .filter((v) => v.required && !(v.name in provided))
    .map((v) => v.name);
}

function emptyState(processName: string): EngineState {
  return {
    processName,
    currentStepId: '',
    variables: new Map(),
    executionTrace: [],
    callStack: [],
  };
}

/**
 * Mock LLM client for tests — returns a fixed "success" response without hitting any API.
 */
function createMockLLMClient(): LLMClient {
  return {
    async call(_options: LLMCallOptions): Promise<string> {
      return JSON.stringify({ status: 'success', extractedData: 'mock output' });
    },
  };
}
