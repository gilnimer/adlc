/**
 * cloud-agent-ops.ts — Fire-and-forget trigger + result extraction for
 * event-driven Actions workflows.
 *
 * Unlike the monolithic `createCloudAgentExecutor` (which polls), these
 * functions split the lifecycle so the Actions runner can exit after
 * triggering and resume in a new run when the PR event arrives.
 *
 *   triggerCloudAgent()       → creates issue, returns immediately
 *   extractCloudAgentResult() → reads completed PR, returns AdapterResponse
 *   findLinkedPR()            → discovers PR linked to an issue
 */
import type { Octokit } from '@octokit/rest';
import type { Step, AdapterResponse } from '@aoml/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TriggerOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  /** Branch the cloud agent should start from */
  baseBranch: string;
  /** Resolve agent name → model string (from AgentRegistry) */
  modelResolver?: (agentName: string) => string | undefined;
  /**
   * Seconds to wait before checking the issue for an immediate agent error.
   * Set to 0 to skip verification. Default: 10.
   */
  verifyDelaySeconds?: number;
}

export interface TriggerResult {
  issueNumber: number;
  issueUrl: string;
}

export interface ExtractOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
}

// ---------------------------------------------------------------------------
// Trigger — fire-and-forget
// ---------------------------------------------------------------------------

/**
 * Create a GitHub issue and assign it to the Copilot cloud agent.
 * Returns immediately after the issue is created — no polling.
 */
export async function triggerCloudAgent(
  step: Step,
  prompt: string,
  variables: Map<string, unknown>,
  options: TriggerOptions
): Promise<TriggerResult> {
  const { octokit, owner, repo, baseBranch, modelResolver } = options;
  const agentName = step.agent ?? 'copilot';

  const issueTitle = `[AOML] Step: ${step.id} — agent: ${agentName}`;
  const issueBody = formatIssueBody(step, prompt, variables);

  const { data: issue } = await octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner,
    repo,
    title: issueTitle,
    body: issueBody,
    labels: ['aoml-orchestration'],
    assignees: ['copilot-swe-agent[bot]'],
    agent_assignment: {
      target_repo: `${owner}/${repo}`,
      base_branch: baseBranch,
      custom_instructions: prompt,
      custom_agent: agentName !== 'copilot' ? agentName : '',
      model: modelResolver?.(agentName) ?? '',
    },
  });

  const result: TriggerResult = {
    issueNumber: issue.number,
    issueUrl: issue.html_url,
  };

  // Verify the agent didn't immediately fail
  const verifyDelay = options.verifyDelaySeconds ?? 10;
  if (verifyDelay > 0) {
    await verifyAgentStarted(octokit, owner, repo, issue.number, verifyDelay);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Extract — read PR result
// ---------------------------------------------------------------------------

/**
 * Read the PR body + changed files and return a structured AdapterResponse.
 * Call this after the cloud agent finishes (PR has review_requested).
 */
export async function extractCloudAgentResult(options: ExtractOptions): Promise<AdapterResponse> {
  const { octokit, owner, repo, prNumber } = options;

  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  const changedFiles = files.map(
    (f) => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`
  );

  const extractedData = [
    `PR #${prNumber}: ${pr.title}`,
    '',
    pr.body ?? '',
    '',
    '### Changed files',
    ...changedFiles,
  ].join('\n');

  return {
    status: 'success',
    extractedData,
  };
}

// ---------------------------------------------------------------------------
// Find linked PR — for event-driven resume
// ---------------------------------------------------------------------------

/**
 * Find the PR linked to a given issue number.
 * Used when a `pull_request.review_requested` event fires and we need to
 * match it back to the AOML step's issue.
 */
export async function findLinkedPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<{ prNumber: number; prBranch: string } | null> {
  // Strategy 1: timeline cross-referenced / connected events
  const { data: events } = await octokit.issues.listEventsForTimeline({
    owner,
    repo,
    issue_number: issueNumber,
  });

  for (const event of events) {
    if (
      event.event === 'cross-referenced' &&
      'source' in event &&
      (event as any).source?.issue?.pull_request
    ) {
      const linkedPR = (event as any).source.issue;
      return { prNumber: linkedPR.number, prBranch: '' };
    }
  }

  // Strategy 2: connected event → search open PRs
  const hasConnected = events.some((e) => e.event === 'connected');
  if (hasConnected) {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      state: 'open',
      sort: 'created',
      direction: 'desc',
      per_page: 10,
    });

    for (const pr of prs) {
      const mentionsIssue =
        pr.body?.includes(`#${issueNumber}`) || pr.body?.includes(`issues/${issueNumber}`);
      const byBot = pr.user?.type === 'Bot';
      if (mentionsIssue || byBot) {
        return { prNumber: pr.number, prBranch: pr.head.ref };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatIssueBody(step: Step, prompt: string, variables: Map<string, unknown>): string {
  const varsSection =
    variables.size > 0
      ? `### Variables\n\n${[...variables.entries()].map(([k, v]) => `- **${k}**: ${String(v)}`).join('\n')}\n\n`
      : '';

  return [
    '> This issue was automatically created by the AOML orchestration engine.',
    '> The cloud agent should follow the instructions below.',
    '',
    `### Step: \`${step.id}\``,
    '',
    step.agent ? `**Agent:** ${step.agent}` : '',
    '',
    '### Instructions',
    '',
    prompt,
    '',
    varsSection,
    '---',
    '*Do not modify this issue. The AOML engine will track completion automatically.*',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Wait briefly then check the issue for an immediate agent error comment.
 * Throws if the agent posted an error (e.g. ruleset violation, permissions).
 */
async function verifyAgentStarted(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  delaySeconds: number
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000));

  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 5,
  });

  for (const comment of comments) {
    const isAgent =
      comment.user?.login === 'copilot-swe-agent' ||
      comment.user?.login === 'copilot-swe-agent[bot]' ||
      comment.user?.type === 'Bot';

    if (isAgent && comment.body?.includes('encountered an error')) {
      throw new Error(`Cloud agent failed on issue #${issueNumber}: ${comment.body.slice(0, 300)}`);
    }
  }
}

// ===========================================================================
// Agent Tasks API (v2026-03-10)
// https://docs.github.com/en/rest/agent-tasks/agent-tasks
// ===========================================================================

export interface TaskStartOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  prompt: string;
  baseRef?: string;
  model?: string;
  createPullRequest?: boolean;
}

export interface AgentTask {
  id: string;
  url: string;
  htmlUrl: string;
  name: string;
  state: 'queued' | 'in_progress' | 'completed' | 'failed' | 'idle' | 'waiting_for_user' | 'timed_out' | 'cancelled';
  sessionCount: number;
  artifacts: Array<{ provider: string; type: string; data: { id: number } }>;
  createdAt: string;
  updatedAt: string;
  sessions?: Array<{
    id: string;
    state: string;
    prompt: string;
    headRef: string;
    baseRef: string;
    model: string;
    completedAt?: string;
  }>;
}

const TASKS_API_VERSION = '2026-03-10';

function toAgentTask(raw: any): AgentTask {
  return {
    id: raw.id,
    url: raw.url,
    htmlUrl: raw.html_url,
    name: raw.name,
    state: raw.state,
    sessionCount: raw.session_count,
    artifacts: raw.artifacts ?? [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    sessions: raw.sessions?.map((s: any) => ({
      id: s.id,
      state: s.state,
      prompt: s.prompt,
      headRef: s.head_ref,
      baseRef: s.base_ref,
      model: s.model,
      completedAt: s.completed_at,
    })),
  };
}

/**
 * Start a Copilot cloud agent task via the Agent Tasks API.
 * POST /agents/repos/{owner}/{repo}/tasks
 */
export async function startAgentTask(options: TaskStartOptions): Promise<AgentTask> {
  const { octokit, owner, repo, prompt, baseRef, model, createPullRequest } = options;

  const body: Record<string, unknown> = { prompt };
  if (baseRef) body.base_ref = baseRef;
  if (model) body.model = model;
  if (createPullRequest !== undefined) body.create_pull_request = createPullRequest;

  const { data } = await octokit.request('POST /agents/repos/{owner}/{repo}/tasks', {
    owner,
    repo,
    ...body,
    headers: { 'X-GitHub-Api-Version': TASKS_API_VERSION },
  });

  return toAgentTask(data);
}

/**
 * Get a task by ID via the Agent Tasks API.
 * GET /agents/repos/{owner}/{repo}/tasks/{task_id}
 */
export async function getAgentTask(
  octokit: Octokit,
  owner: string,
  repo: string,
  taskId: string
): Promise<AgentTask> {
  const { data } = await octokit.request('GET /agents/repos/{owner}/{repo}/tasks/{task_id}', {
    owner,
    repo,
    task_id: taskId,
    headers: { 'X-GitHub-Api-Version': TASKS_API_VERSION },
  });

  return toAgentTask(data);
}

/**
 * Poll a task until it reaches a terminal state.
 * Returns the final task state with artifacts (including PR ID).
 */
export async function waitForAgentTask(
  octokit: Octokit,
  owner: string,
  repo: string,
  taskId: string,
  options?: { timeoutSec?: number; intervalSec?: number }
): Promise<AgentTask> {
  const timeoutMs = (options?.timeoutSec ?? 300) * 1000;
  const intervalMs = (options?.intervalSec ?? 15) * 1000;
  const startTime = Date.now();

  const terminalStates = new Set(['completed', 'failed', 'timed_out', 'cancelled']);

  while (true) {
    const task = await getAgentTask(octokit, owner, repo, taskId);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (terminalStates.has(task.state)) {
      return task;
    }

    if (Date.now() - startTime >= timeoutMs) {
      throw new Error(`Timeout after ${Math.round(timeoutMs / 1000)}s waiting for task ${taskId} (state: ${task.state})`);
    }

    console.error(`[${elapsed}s] Task ${taskId} state: ${task.state}...`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
