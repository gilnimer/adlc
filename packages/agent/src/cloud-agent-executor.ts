/**
 * CloudAgentExecutor — a StepExecutor that triggers real GitHub Copilot
 * cloud agent sessions for each AOML step.
 *
 * For each step the engine yields:
 * 1. Create a GitHub issue via REST API
 * 2. Assign it to `copilot-swe-agent[bot]` with custom_agent + custom_instructions
 * 3. Poll for session completion (PR created and review requested)
 * 4. Parse the result (PR diff / body) and return a structured AdapterResponse
 *
 * This keeps the AOML engine 100% deterministic — it controls the flow,
 * gateways, loops, and routing. Each step is an "island" of agentic work
 * that runs on GitHub's cloud infrastructure.
 */
import type { Octokit } from '@octokit/rest';
import type { Step, AdapterResponse } from '@aoml/core';
import type { StepExecutor } from '@aoml/core';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CloudAgentConfig {
  /** Authenticated Octokit instance */
  octokit: Octokit;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Base branch for the cloud agent to branch from (default: "main") */
  baseBranch?: string;
  /** Polling interval in ms (default: 10_000) */
  pollIntervalMs?: number;
  /** Max time to wait for a session to complete in ms (default: 600_000 = 10 min) */
  timeoutMs?: number;
  /** Optional callback for progress updates */
  onProgress?: (stepId: string, message: string) => void;
}

// ---------------------------------------------------------------------------
// Session status tracking
// ---------------------------------------------------------------------------

export interface SessionInfo {
  issueNumber: number;
  issueUrl: string;
  prNumber?: number;
  prUrl?: string;
  prBranch?: string;
  status: 'pending' | 'working' | 'completed' | 'failed';
}

// ---------------------------------------------------------------------------
// Cloud Agent Executor
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Create a StepExecutor that delegates each step to the GitHub Copilot
 * cloud agent via the Issues REST API.
 */
export function createCloudAgentExecutor(config: CloudAgentConfig): StepExecutor {
  const {
    octokit,
    owner,
    repo,
    baseBranch = 'main',
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    onProgress,
  } = config;

  // Track the branch from the last step so work can be chained
  let lastBranch = baseBranch;

  return async (step: Step, prompt: string, variables: Map<string, unknown>): Promise<AdapterResponse> => {
    const agentName = step.agent ?? 'copilot';

    // 1. Create issue with the step's prompt as instructions
    onProgress?.(step.id, `Creating issue for step "${step.id}" → agent "${agentName}"...`);

    const issueTitle = `[AOML] Step: ${step.id} — agent: ${agentName}`;
    const issueBody = formatIssueBody(step, prompt, variables);

    const { data: issue } = await octokit.issues.create({
      owner,
      repo,
      title: issueTitle,
      body: issueBody,
      labels: ['aoml-orchestration'],
    });

    onProgress?.(step.id, `Issue #${issue.number} created. Assigning to cloud agent...`);

    // 2. Assign to copilot-swe-agent[bot] with custom agent + instructions
    await octokit.issues.addAssignees({
      owner,
      repo,
      issue_number: issue.number,
      assignees: ['copilot-swe-agent[bot]'],
    });

    // Set agent assignment metadata via PATCH
    await octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
      owner,
      repo,
      issue_number: issue.number,
      assignees: ['copilot-swe-agent[bot]'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agent_assignment: {
        target_repo: `${owner}/${repo}`,
        base_branch: lastBranch,
        custom_instructions: prompt,
        custom_agent: agentName,
        model: '',
      },
    } as any);

    onProgress?.(step.id, `Cloud agent session started. Polling for completion...`);

    // 3. Poll for completion — watch for a PR linked to this issue
    const session = await pollForCompletion({
      octokit,
      owner,
      repo,
      issueNumber: issue.number,
      pollIntervalMs,
      timeoutMs,
      onProgress: (msg) => onProgress?.(step.id, msg),
    });

    // 4. Parse the result
    if (session.status === 'failed') {
      return {
        status: 'fail',
        extractedData: `Cloud agent session failed for step "${step.id}". Issue: ${session.issueUrl}`,
      };
    }

    // Update lastBranch so next step chains off this PR's branch
    if (session.prBranch) {
      lastBranch = session.prBranch;
    }

    // Read the PR body/diff for structured output
    const extractedData = await extractResultFromPR({
      octokit,
      owner,
      repo,
      prNumber: session.prNumber!,
    });

    onProgress?.(step.id, `Step "${step.id}" completed. PR: ${session.prUrl}`);

    return {
      status: 'success',
      extractedData,
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatIssueBody(
  step: Step,
  prompt: string,
  variables: Map<string, unknown>
): string {
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

interface PollOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  issueNumber: number;
  pollIntervalMs: number;
  timeoutMs: number;
  onProgress?: (message: string) => void;
}

async function pollForCompletion(options: PollOptions): Promise<SessionInfo> {
  const { octokit, owner, repo, issueNumber, pollIntervalMs, timeoutMs, onProgress } = options;
  const deadline = Date.now() + timeoutMs;

  const session: SessionInfo = {
    issueNumber,
    issueUrl: `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
    status: 'pending',
  };

  while (Date.now() < deadline) {
    // Check for linked PRs via timeline events
    const { data: events } = await octokit.issues.listEventsForTimeline({
      owner,
      repo,
      issue_number: issueNumber,
    });

    // Look for a cross-referenced PR from the bot
    for (const event of events) {
      if (
        event.event === 'cross-referenced' &&
        'source' in event &&
        (event as any).source?.issue?.pull_request
      ) {
        const linkedPR = (event as any).source.issue;
        session.prNumber = linkedPR.number;
        session.prUrl = linkedPR.html_url;
        session.status = 'working';

        // Check if the PR has been marked ready for review (agent is done)
        const { data: pr } = await octokit.pulls.get({
          owner,
          repo,
          pull_number: linkedPR.number,
        });

        session.prBranch = pr.head.ref;

        // The agent requests review when it's done
        if (pr.requested_reviewers && pr.requested_reviewers.length > 0) {
          session.status = 'completed';
          return session;
        }

        // Also check if PR is merged or closed
        if (pr.state === 'closed' || pr.merged) {
          session.status = 'completed';
          return session;
        }
      }
    }

    // Check if the issue was closed (agent might fail without a PR)
    const { data: issue } = await octokit.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    if (issue.state === 'closed' && !session.prNumber) {
      session.status = 'failed';
      return session;
    }

    onProgress?.(`Still waiting... (PR: ${session.prNumber ? `#${session.prNumber}` : 'not yet created'})`);
    await delay(pollIntervalMs);
  }

  // Timeout — treat as failure
  session.status = 'failed';
  return session;
}

async function extractResultFromPR(options: {
  octokit: Octokit;
  owner: string;
  repo: string;
  prNumber: number;
}): Promise<string> {
  const { octokit, owner, repo, prNumber } = options;

  const { data: pr } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  // Get list of changed files as a summary
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  const changedFiles = files.map((f) => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`);

  return [
    `PR #${prNumber}: ${pr.title}`,
    '',
    pr.body ?? '',
    '',
    '### Changed files',
    ...changedFiles,
  ].join('\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
