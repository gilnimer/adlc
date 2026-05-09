import { resolve, dirname } from 'node:path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import {
  parseAomlFile,
  Engine,
  createAdapterExecutor,
  AgentRegistry,
  serializeState,
  type SubFlowLoader,
  type EngineState,
  type LLMClient,
  type LLMCallOptions,
  type SerializedEngineState,
} from '@aoml/core';
import {
  createCloudAgentExecutor,
  triggerCloudAgent,
  extractCloudAgentResult,
  type CloudAgentConfig,
  type TriggerOptions,
} from '@aoml/agent';
import { Octokit } from '@octokit/rest';

/** Default LLM call timeout in ms — per TSD §9 */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * LLMClient backed by @github/copilot-sdk with PAT authentication.
 * Injected by @aoml/action for remote execution (GitHub Actions / Cloud Agents).
 * Per TSD §8.2: "Provider Injector: @aoml/action injects @github/copilot-sdk."
 */
class CopilotLLMClient implements LLMClient {
  private readonly token: string;
  private readonly sessionContext?: Record<string, string>;
  private readonly timeoutMs: number;
  private sdk: CopilotSDKHandle | null = null;

  constructor(
    token: string,
    sessionContext?: Record<string, string>,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ) {
    this.token = token;
    this.sessionContext = sessionContext;
    this.timeoutMs = timeoutMs;
  }

  private async getSDK(): Promise<CopilotSDKHandle> {
    if (this.sdk) return this.sdk;
    // Dynamic import keeps @github/copilot-sdk as an optional peer dep
    const mod = await (import('@github/copilot-sdk' as string) as Promise<any>);
    this.sdk = new mod.CopilotClient({ token: this.token }) as CopilotSDKHandle;
    return this.sdk;
  }

  async call(options: LLMCallOptions): Promise<string> {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`LLM call timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs
      )
    );

    const request = async (): Promise<string> => {
      const client = await this.getSDK();
      const session = await client.createSession({
        model: options.model,
        temperature: options.temperature,
        ...(options.tools && { tools: options.tools }),
        ...(this.sessionContext && { context: this.sessionContext }),
      });
      const response = await session.sendMessage({
        systemPrompt: options.systemPrompt,
        userPrompt: options.userPrompt,
      });
      return response.text;
    };

    return Promise.race([request(), timeout]);
  }
}

interface CopilotSDKHandle {
  createSession(options: {
    model: string;
    temperature: number;
    tools?: string[];
    context?: Record<string, string>;
  }): Promise<{
    sendMessage(o: { systemPrompt: string; userPrompt: string }): Promise<{ text: string }>;
  }>;
}

export interface ActionInputs {
  workflowFile: string;
  variables: Record<string, string>;
  /**
   * GitHub token with Copilot scopes — injected via `secrets.COPILOT_GITHUB_TOKEN`.
   * Per TSD §9.2: "Authentication is handled seamlessly by a Fine-Grained PAT
   * with Copilot scopes injected securely via repository secrets."
   */
  githubToken: string;
  /**
   * Repository root path (defaults to GITHUB_WORKSPACE in Actions).
   */
  workspacePath?: string;
  /**
   * Execution mode:
   * - "local" — LLM calls via Copilot SDK (default, existing behavior)
   * - "cloud-agent" — triggers Copilot cloud agent sessions per step
   */
  executionMode?: 'local' | 'cloud-agent';
  /**
   * Repository owner (required for cloud-agent mode).
   * Defaults to GITHUB_REPOSITORY_OWNER in Actions.
   */
  owner?: string;
  /**
   * Repository name (required for cloud-agent mode).
   * Defaults to GITHUB_REPOSITORY in Actions.
   */
  repoName?: string;
}

export interface ActionOutputs {
  status: string;
  trace: string;
  summary: string;
}

/**
 * Create the LLMClient for GitHub Actions / Cloud Agent execution.
 * Uses a PAT with Copilot scopes for authentication in the ephemeral runner.
 * Per TSD §9.2: "The Engine runs in an isolated, ephemeral GitHub Actions runner
 * or a dedicated Copilot Cloud Agent VM."
 */
export function createCloudLLMClient(githubToken: string, timeoutMs?: number): LLMClient {
  return new CopilotLLMClient(
    githubToken,
    { environment: 'cloud', surface: 'github-actions' },
    timeoutMs
  );
}

/**
 * Run the AOML engine as a GitHub Action / Cloud Agent.
 * Uses @github/copilot-sdk with PAT authentication for LLM calls.
 */
export async function runAction(inputs: ActionInputs): Promise<ActionOutputs> {
  if (inputs.executionMode === 'cloud-agent') {
    return runCloudAction(inputs);
  }
  return runLocalAction(inputs);
}

/**
 * Cloud-agent mode: each step triggers a real Copilot cloud agent session
 * via the Issues REST API. The AOML engine remains deterministic.
 */
async function runCloudAction(inputs: ActionInputs): Promise<ActionOutputs> {
  const workspacePath = inputs.workspacePath ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const fullPath = resolve(workspacePath, inputs.workflowFile);
  const aomlProcess = parseAomlFile(fullPath);

  const [owner, repoName] = resolveRepo(inputs);

  const octokit = new Octokit({
    auth: inputs.githubToken,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  });

  // Load agent configs so the cloud executor can forward the model setting
  const agentsDir = resolve(workspacePath, '.github', 'agents');
  const registry = new AgentRegistry(agentsDir);

  const executor = createCloudAgentExecutor({
    octokit,
    owner,
    repo: repoName,
    baseBranch: process.env.GITHUB_REF_NAME ?? 'main',
    onProgress: (stepId, message) => {
      console.log(`[${stepId}] ${message}`);
    },
    modelResolver: (agentName) => {
      try {
        return registry.resolve(agentName).model;
      } catch {
        return undefined;
      }
    },
  });

  const subFlowLoader: SubFlowLoader = (src) => {
    const basePath = dirname(fullPath);
    return parseAomlFile(resolve(basePath, src));
  };

  // Use a no-op executor — we drive steps manually via the async generator
  const noopExecutor: import('@aoml/core').StepExecutor = () => {
    throw new Error('unreachable — cloud-agent mode uses steps() generator');
  };

  const engine = new Engine({
    process: aomlProcess,
    variables: inputs.variables,
    stepExecutor: noopExecutor,
    subFlowLoader,
  });

  for await (const request of engine.steps()) {
    const stepIndex = engine.getState().executionTrace.length + 1;
    const totalSteps = aomlProcess.steps.length;
    console.log(
      `[aoml] Step ${stepIndex}/${totalSteps}: ${request.step.id} (agent: ${request.step.agent ?? 'default'})`
    );

    // System steps are terminal — no cloud agent session needed
    if (request.step.agent === 'system') {
      console.log(`[aoml] Skipping cloud agent for system step "${request.step.id}"`);
      engine.receiveResult(request, {
        rawOutput: request.prompt,
        response: { status: 'success', extractedData: request.prompt },
      });
      continue;
    }

    try {
      const result = await executor(request.step, request.prompt, new Map(request.variables));
      engine.receiveResult(request, {
        rawOutput: result.extractedData,
        response: result,
      });
    } catch (error) {
      console.error(`[aoml] Step "${request.step.id}" failed:`, error);
      engine.receiveResult(request, {
        rawOutput: error instanceof Error ? error.message : String(error),
        response: {
          status: '_error',
          extractedData: error instanceof Error ? error.message : String(error),
        },
        error,
      });
    }
  }

  const finalState = engine.getState();

  return {
    status: getOverallStatus(finalState),
    trace: JSON.stringify(finalState.executionTrace, null, 2),
    summary: formatActionSummary(finalState),
  };
}

function resolveRepo(inputs: { owner?: string; repoName?: string }): [string, string] {
  if (inputs.owner && inputs.repoName) {
    return [inputs.owner, inputs.repoName];
  }
  const fullRepo = process.env.GITHUB_REPOSITORY ?? '';
  const [owner, repoName] = fullRepo.split('/');
  return [inputs.owner ?? owner ?? 'unknown', inputs.repoName ?? repoName ?? 'unknown'];
}

/**
 * Local mode: uses @github/copilot-sdk with PAT authentication for LLM calls.
 */
async function runLocalAction(inputs: ActionInputs): Promise<ActionOutputs> {
  const workspacePath = inputs.workspacePath ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const fullPath = resolve(workspacePath, inputs.workflowFile);
  const aomlProcess = parseAomlFile(fullPath);

  // Create Copilot SDK client with cloud PAT auth
  const llmClient = createCloudLLMClient(inputs.githubToken);

  // Load agent configs from repo .github/agents/
  const agentsDir = resolve(workspacePath, '.github', 'agents');
  const registry = new AgentRegistry(agentsDir);

  // Build worker config map
  const workerConfigs = new Map<string, import('@aoml/core').AgentConfig>();
  for (const step of aomlProcess.steps) {
    if (step.agent && !workerConfigs.has(step.agent)) {
      workerConfigs.set(step.agent, registry.resolve(step.agent));
    }
  }

  const adapterConfig = registry.resolve('aoml-adapter');

  // Full adapter-sandwich executor backed by real Copilot SDK
  const executor = createAdapterExecutor(llmClient, workerConfigs, adapterConfig);

  const subFlowLoader: SubFlowLoader = (src) => {
    const basePath = dirname(fullPath);
    return parseAomlFile(resolve(basePath, src));
  };

  const engine = new Engine({
    process: aomlProcess,
    variables: inputs.variables,
    stepExecutor: executor,
    subFlowLoader,
  });

  const finalState = await engine.run();

  const trace = JSON.stringify(finalState.executionTrace, null, 2);
  const summary = formatActionSummary(finalState);

  return {
    status: getOverallStatus(finalState),
    trace,
    summary,
  };
}

/**
 * Format execution state as a Markdown summary for PR comments.
 * Per TSD §9.2: "Progress and final execution traces are reported asynchronously
 * via GitHub Issue comments, PR summaries, or the GitHub Agent HQ dashboard."
 */
export function formatActionSummary(state: EngineState): string {
  const lines: string[] = [];
  lines.push('## AOML Execution Report');
  lines.push('');
  lines.push(`**Process:** ${state.processName}`);
  lines.push('');
  lines.push('| Step | Agent | Status | Latency |');
  lines.push('|------|-------|--------|---------|');

  for (const entry of state.executionTrace) {
    const statusEmoji =
      entry.status === 'success' || entry.status === 'approve'
        ? '✅'
        : entry.status === 'fail'
          ? '❌'
          : '⚠️';
    lines.push(
      `| ${entry.stepId} | ${entry.agent} | ${statusEmoji} ${entry.status} | ${entry.latencyMs}ms |`
    );
  }

  return lines.join('\n');
}

function getOverallStatus(state: EngineState): string {
  const lastEntry = state.executionTrace[state.executionTrace.length - 1];
  return lastEntry?.status ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Event-driven mode — one step per workflow run (no polling)
// ---------------------------------------------------------------------------

/** Persistent checkpoint written to `.aoml-state/checkpoint.json` */
interface StepCheckpoint {
  /** Serialized engine state (paused just before the current step) */
  engineState: SerializedEngineState;
  /** Issue number created for the current in-flight step */
  issueNumber: number;
  /** Step id that is in-flight */
  stepId: string;
  /** Branch the agent is working from */
  baseBranch: string;
  /** The original workflow file path */
  workflowFile: string;
  /** Original input variables */
  variables: Record<string, string>;
}

const CHECKPOINT_DIR = '.aoml-state';
const CHECKPOINT_FILE = 'checkpoint.json';

function checkpointPath(workspacePath: string): string {
  return resolve(workspacePath, CHECKPOINT_DIR, CHECKPOINT_FILE);
}

function saveCheckpoint(workspacePath: string, checkpoint: StepCheckpoint): void {
  const dir = resolve(workspacePath, CHECKPOINT_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(checkpointPath(workspacePath), JSON.stringify(checkpoint, null, 2));
}

function loadCheckpoint(workspacePath: string): StepCheckpoint | null {
  const path = checkpointPath(workspacePath);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

export interface EventDrivenInputs {
  workflowFile: string;
  variables: Record<string, string>;
  githubToken: string;
  workspacePath?: string;
  owner?: string;
  repoName?: string;
  /** For `continue`: the PR number that just completed */
  prNumber?: number;
}

/**
 * Start the AOML workflow: advance the engine to the first non-system step,
 * trigger the cloud agent, save state, and exit. No polling.
 */
export async function startStep(inputs: EventDrivenInputs): Promise<{
  issueNumber: number;
  stepId: string;
  done: boolean;
}> {
  const workspacePath = inputs.workspacePath ?? process.cwd();
  const fullPath = resolve(workspacePath, inputs.workflowFile);
  const aomlProcess = parseAomlFile(fullPath);
  const [owner, repoName] = resolveRepo(inputs);

  const octokit = new Octokit({
    auth: inputs.githubToken,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  });

  const agentsDir = resolve(workspacePath, '.github', 'agents');
  const registry = new AgentRegistry(agentsDir);

  const noopExecutor: import('@aoml/core').StepExecutor = () => {
    throw new Error('unreachable');
  };

  const engine = new Engine({
    process: aomlProcess,
    variables: inputs.variables,
    stepExecutor: noopExecutor,
  });

  // Advance through system steps until we hit one that needs the cloud agent
  for await (const request of engine.steps()) {
    if (request.step.agent === 'system') {
      engine.receiveResult(request, {
        rawOutput: request.prompt,
        response: { status: 'success', extractedData: request.prompt },
      });
      continue;
    }

    // Found a real step — trigger cloud agent and save checkpoint
    const baseBranch = process.env.GITHUB_REF_NAME ?? 'main';
    const triggerOpts: TriggerOptions = {
      octokit,
      owner,
      repo: repoName,
      baseBranch,
      modelResolver: (agentName) => {
        try {
          return registry.resolve(agentName).model;
        } catch {
          return undefined;
        }
      },
    };

    const { issueNumber } = await triggerCloudAgent(
      request.step,
      request.prompt,
      new Map(request.variables),
      triggerOpts
    );

    console.log(`[aoml] Triggered step "${request.step.id}" → issue #${issueNumber}`);

    // Save checkpoint so the next workflow run can resume
    saveCheckpoint(workspacePath, {
      engineState: serializeState(engine.getState()),
      issueNumber,
      stepId: request.step.id,
      baseBranch,
      workflowFile: inputs.workflowFile,
      variables: inputs.variables,
    });

    return { issueNumber, stepId: request.step.id, done: false };
  }

  // No non-system steps — workflow is done
  return { issueNumber: 0, stepId: '', done: true };
}

/**
 * Continue the AOML workflow after a cloud agent step completed.
 * Reads the PR result, feeds it back to the engine, advances to the next step,
 * triggers the next cloud agent (if any), saves state, and exits.
 */
export async function continueStep(inputs: EventDrivenInputs): Promise<{
  issueNumber: number;
  stepId: string;
  done: boolean;
  summary?: string;
}> {
  const workspacePath = inputs.workspacePath ?? process.cwd();
  const checkpoint = loadCheckpoint(workspacePath);
  if (!checkpoint) {
    throw new Error('No checkpoint found — run startStep first');
  }

  const fullPath = resolve(workspacePath, checkpoint.workflowFile);
  const aomlProcess = parseAomlFile(fullPath);
  const [owner, repoName] = resolveRepo(inputs);

  const octokit = new Octokit({
    auth: inputs.githubToken,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  });

  const agentsDir = resolve(workspacePath, '.github', 'agents');
  const registry = new AgentRegistry(agentsDir);

  if (!inputs.prNumber) {
    throw new Error('continueStep requires prNumber (the PR that just completed)');
  }

  // Extract result from the completed PR
  const result = await extractCloudAgentResult({
    octokit,
    owner,
    repo: repoName,
    prNumber: inputs.prNumber,
  });

  // Get the branch from the completed PR for chaining
  const { data: pr } = await octokit.pulls.get({
    owner,
    repo: repoName,
    pull_number: inputs.prNumber,
  });
  const nextBaseBranch = pr.head.ref;

  console.log(`[aoml] Step "${checkpoint.stepId}" completed via PR #${inputs.prNumber}`);

  // Restore engine from checkpoint
  const noopExecutor: import('@aoml/core').StepExecutor = () => {
    throw new Error('unreachable');
  };

  const engine = new Engine({
    process: aomlProcess,
    variables: checkpoint.variables,
    stepExecutor: noopExecutor,
    restoreState: checkpoint.engineState,
  });

  // Feed the result back and advance
  let fed = false;
  for await (const request of engine.steps()) {
    if (!fed) {
      // This is the step we were waiting on — feed the result
      engine.receiveResult(request, {
        rawOutput: result.extractedData,
        response: result,
      });
      fed = true;
      continue;
    }

    // Skip system steps
    if (request.step.agent === 'system') {
      engine.receiveResult(request, {
        rawOutput: request.prompt,
        response: { status: 'success', extractedData: request.prompt },
      });
      continue;
    }

    // Found the next real step — trigger and checkpoint
    const triggerOpts: TriggerOptions = {
      octokit,
      owner,
      repo: repoName,
      baseBranch: nextBaseBranch,
      modelResolver: (agentName) => {
        try {
          return registry.resolve(agentName).model;
        } catch {
          return undefined;
        }
      },
    };

    const { issueNumber } = await triggerCloudAgent(
      request.step,
      request.prompt,
      new Map(request.variables),
      triggerOpts
    );

    console.log(`[aoml] Triggered next step "${request.step.id}" → issue #${issueNumber}`);

    saveCheckpoint(workspacePath, {
      engineState: serializeState(engine.getState()),
      issueNumber,
      stepId: request.step.id,
      baseBranch: nextBaseBranch,
      workflowFile: checkpoint.workflowFile,
      variables: checkpoint.variables,
    });

    return { issueNumber, stepId: request.step.id, done: false };
  }

  // No more steps — workflow complete
  const finalState = engine.getState();
  const summary = formatActionSummary(finalState);
  console.log(`[aoml] Workflow complete!\n${summary}`);

  return { issueNumber: 0, stepId: '', done: true, summary };
}
