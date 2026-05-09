/**
 * aoml-pipeline CLI — minimal entry points for GitHub Actions `run:` steps.
 *
 * Commands:
 *   trigger  — Create an issue and assign it to the Copilot cloud agent
 *   extract  — Read a completed PR and return the result as JSON
 *   checkpoint save  — Save pipeline state to .aoml-state/
 *   checkpoint load  — Load and print pipeline state
 *
 * Usage from a workflow step:
 *   node packages/agent/dist/pipeline-cli.js trigger \
 *     --step "create-readme" --agent developer \
 *     --prompt "Create a README.md..." \
 *     --owner gilnimer --repo adlc --base main
 *
 *   node packages/agent/dist/pipeline-cli.js extract \
 *     --pr 12 --owner gilnimer --repo adlc
 */
import {
  triggerCloudAgent,
  extractCloudAgentResult,
  findLinkedPR,
  startAgentTask,
  waitForAgentTask,
} from './cloud-agent-ops.js';
import { Octokit } from '@octokit/rest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Step } from '@aoml/core';

// ---------------------------------------------------------------------------
// Arg parser (minimal — no deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      args[key] = next && !next.startsWith('--') ? next : 'true';
      if (next && !next.startsWith('--')) i++;
    }
  }
  return args;
}

function required(args: Record<string, string>, key: string): string {
  const val = args[key];
  if (!val) {
    console.error(`Missing required argument: --${key}`);
    process.exit(1);
  }
  return val;
}

// ---------------------------------------------------------------------------
// Checkpoint helpers
// ---------------------------------------------------------------------------

interface PipelineCheckpoint {
  currentStep: string;
  issueNumber: number;
  baseBranch: string;
  variables: Record<string, string>;
  completedSteps: Array<{
    stepId: string;
    prNumber: number;
    result: string;
  }>;
}

const CHECKPOINT_DIR = '.aoml-state';
const CHECKPOINT_FILE = 'pipeline.json';

function checkpointPath(cwd: string): string {
  return resolve(cwd, CHECKPOINT_DIR, CHECKPOINT_FILE);
}

function saveCheckpoint(cwd: string, checkpoint: PipelineCheckpoint): void {
  const dir = resolve(cwd, CHECKPOINT_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(checkpointPath(cwd), JSON.stringify(checkpoint, null, 2));
}

function loadCheckpoint(cwd: string): PipelineCheckpoint | null {
  const path = checkpointPath(cwd);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdTrigger(args: Record<string, string>): Promise<void> {
  const stepId = required(args, 'step');
  const agent = required(args, 'agent');
  const prompt = required(args, 'prompt');
  const owner = required(args, 'owner');
  const repo = required(args, 'repo');
  const baseBranch = args['base'] ?? 'main';
  const model = args['model'] ?? '';
  const verifyDelay = parseInt(args['verify-delay'] ?? '10', 10);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  const octokit = new Octokit({
    auth: token,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  });

  const step: Step = {
    id: stepId,
    agent,
    input: { text: prompt, format: 'text' },
    output: { saveAs: `${stepId}_result` },
    routing: { onStatus: [], onError: undefined, onMaxRetries: undefined },
  };

  const result = await triggerCloudAgent(
    step,
    prompt,
    new Map(
      Object.entries(args)
        .filter(([k]) => k.startsWith('var-'))
        .map(([k, v]) => [k.slice(4), v])
    ),
    {
      octokit,
      owner,
      repo,
      baseBranch,
      modelResolver: model ? () => model : undefined,
      verifyDelaySeconds: verifyDelay,
    }
  );

  // Output as GitHub Actions outputs
  console.log(JSON.stringify(result, null, 2));

  // Set outputs for workflow use
  appendOutput('issue-number', String(result.issueNumber));
  appendOutput('issue-url', result.issueUrl);
}

async function cmdExtract(args: Record<string, string>): Promise<void> {
  const prNumber = parseInt(required(args, 'pr'), 10);
  const owner = required(args, 'owner');
  const repo = required(args, 'repo');

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  const octokit = new Octokit({
    auth: token,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  });

  const result = await extractCloudAgentResult({ octokit, owner, repo, prNumber });

  console.log(JSON.stringify(result, null, 2));

  appendOutput('status', result.status);
  appendOutput('extracted-data', result.extractedData);
}

function cmdCheckpointSave(args: Record<string, string>): void {
  const cwd = args['cwd'] ?? process.cwd();
  const issueRaw = (args['issue'] ?? '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  const issueNum = issueRaw ? Number(issueRaw) : 0;
  const checkpoint: PipelineCheckpoint = {
    currentStep: required(args, 'step'),
    issueNumber: isNaN(issueNum) ? 0 : issueNum,
    baseBranch: args['base'] ?? 'main',
    variables: JSON.parse(args['variables'] ?? '{}'),
    completedSteps: JSON.parse(args['completed'] ?? '[]'),
  };
  saveCheckpoint(cwd, checkpoint);
  console.log(`Checkpoint saved: step=${checkpoint.currentStep}, issue=#${checkpoint.issueNumber}`);
}

function cmdCheckpointLoad(args: Record<string, string>): void {
  const cwd = args['cwd'] ?? process.cwd();
  const checkpoint = loadCheckpoint(cwd);
  if (!checkpoint) {
    console.error('No checkpoint found');
    process.exit(1);
  }
  console.log(JSON.stringify(checkpoint, null, 2));

  appendOutput('current-step', checkpoint.currentStep);
  appendOutput('issue-number', String(checkpoint.issueNumber));
  appendOutput('base-branch', checkpoint.baseBranch);
  appendOutput('variables', JSON.stringify(checkpoint.variables));
  appendOutput('completed-steps', JSON.stringify(checkpoint.completedSteps));
}

async function cmdFindPR(args: Record<string, string>): Promise<void> {
  const issueNumber = parseInt(required(args, 'issue'), 10);
  const owner = required(args, 'owner');
  const repo = required(args, 'repo');
  const timeoutSec = parseInt(args['timeout'] ?? '300', 10);
  const intervalSec = parseInt(args['interval'] ?? '30', 10);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  const octokit = new Octokit({
    auth: token,
    headers: { 'X-GitHub-Api-Version': '2022-11-28' },
  });

  const startTime = Date.now();
  const timeoutMs = timeoutSec * 1000;
  const intervalMs = intervalSec * 1000;

  while (true) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    // First find a linked PR
    const linked = await findLinkedPR(octokit, owner, repo, issueNumber);

    if (linked) {
      // Check if the agent has finished working on the PR
      // by looking for the copilot_work_finished event on the PR timeline
      const { data: events } = await octokit.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: linked.prNumber,
      });

      const workFinished = events.some((e) => e.event === 'copilot_work_finished');

      if (workFinished) {
        console.log(
          JSON.stringify({
            issueNumber,
            prNumber: linked.prNumber,
            prBranch: linked.prBranch,
            elapsed,
          })
        );
        appendOutput('pr-number', String(linked.prNumber));
        appendOutput('pr-branch', linked.prBranch);
        return;
      }

      console.error(`[${elapsed}s] PR #${linked.prNumber} found but agent still working...`);
    }

    // Check for agent error comments on the issue
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
        console.error(`Agent error on issue #${issueNumber}: ${comment.body?.slice(0, 300)}`);
        process.exit(1);
      }
    }

    if (Date.now() - startTime >= timeoutMs) {
      console.error(
        `Timeout after ${timeoutSec}s waiting for agent to finish issue #${issueNumber}`
      );
      process.exit(1);
    }

    if (!linked) {
      console.error(`[${elapsed}s] Waiting for PR linked to issue #${issueNumber}...`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---------------------------------------------------------------------------
// Task commands (Agent Tasks API v2026-03-10)
// ---------------------------------------------------------------------------

async function cmdTaskStart(args: Record<string, string>): Promise<void> {
  const prompt = required(args, 'prompt');
  const owner = required(args, 'owner');
  const repo = required(args, 'repo');
  const baseRef = args['base'] ?? 'main';
  const model = args['model'] ?? '';
  const createPR = args['create-pr'] !== 'false'; // default true

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  const task = await startAgentTask({
    octokit,
    owner,
    repo,
    prompt,
    baseRef,
    model: model || undefined,
    createPullRequest: createPR,
  });

  console.log(JSON.stringify(task, null, 2));

  appendOutput('task-id', task.id);
  appendOutput('task-state', task.state);
  appendOutput('task-url', task.htmlUrl);
}

async function cmdTaskWait(args: Record<string, string>): Promise<void> {
  const taskId = required(args, 'task-id');
  const owner = required(args, 'owner');
  const repo = required(args, 'repo');
  const timeoutSec = parseInt(args['timeout'] ?? '300', 10);
  const intervalSec = parseInt(args['interval'] ?? '15', 10);

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });

  const task = await waitForAgentTask(octokit, owner, repo, taskId, {
    timeoutSec,
    intervalSec,
  });

  // The artifact data.id is the internal PR ID, not the PR number.
  // Look up the actual PR number using the branch name from either
  // the session's headRef or the branch artifact.
  let prNumber: number | null = null;
  const headRef =
    task.sessions?.[0]?.headRef ??
    (task.artifacts.find((a) => a.type === 'branch') as any)?.data?.head_ref;
  if (headRef) {
    const { data: prs } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${headRef}`,
      state: 'open',
      per_page: 1,
    });
    if (prs.length > 0) {
      prNumber = prs[0].number;
    }
  }

  const result = {
    taskId: task.id,
    state: task.state,
    prNumber,
    htmlUrl: task.htmlUrl,
    sessions: task.sessions ?? [],
  };

  console.log(JSON.stringify(result, null, 2));

  appendOutput('task-state', task.state);
  if (prNumber) appendOutput('pr-number', String(prNumber));
}

// ---------------------------------------------------------------------------
// GitHub Actions output helper
// ---------------------------------------------------------------------------

function appendOutput(name: string, value: string): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    const delimiter = `ghadelimiter_${Date.now()}`;
    writeFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, { flag: 'a' });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (command) {
  case 'trigger':
    cmdTrigger(args).catch((err) => {
      console.error('trigger failed:', err.message ?? err);
      process.exit(1);
    });
    break;
  case 'extract':
    cmdExtract(args).catch((err) => {
      console.error('extract failed:', err.message ?? err);
      process.exit(1);
    });
    break;
  case 'find-pr':
    cmdFindPR(args).catch((err) => {
      console.error('find-pr failed:', err.message ?? err);
      process.exit(1);
    });
    break;
  case 'checkpoint':
    if (rest[0] === 'save') cmdCheckpointSave(parseArgs(rest.slice(1)));
    else if (rest[0] === 'load') cmdCheckpointLoad(parseArgs(rest.slice(1)));
    else {
      console.error('Usage: checkpoint save|load');
      process.exit(1);
    }
    break;
  case 'task':
    if (rest[0] === 'start') {
      cmdTaskStart(parseArgs(rest.slice(1))).catch((err) => {
        console.error('task start failed:', err.message ?? err);
        process.exit(1);
      });
    } else if (rest[0] === 'wait') {
      cmdTaskWait(parseArgs(rest.slice(1))).catch((err) => {
        console.error('task wait failed:', err.message ?? err);
        process.exit(1);
      });
    } else {
      console.error('Usage: task start|wait');
      process.exit(1);
    }
    break;
  default:
    console.error('Usage: pipeline-cli <trigger|extract|find-pr|checkpoint|task> [options]');
    process.exit(1);
}
