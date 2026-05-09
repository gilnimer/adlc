/**
 * CloudAgentExecutor — a StepExecutor that triggers real GitHub Copilot
 * cloud agent sessions for each AOML step.
 *
 * For each step the engine yields:
 * 1. Create a GitHub issue with `assignees` + `agent_assignment` in a single REST call
 * 2. Poll for session completion (PR created and review requested)
 * 3. Parse the result (PR diff / body) and return a structured AdapterResponse
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
  /**
   * Optional resolver that maps an agent name to its preferred model.
   * When provided, the model from the agent's .agent.md config is forwarded
   * to the cloud agent via `agent_assignment.model`.
   */
  modelResolver?: (agentName: string) => string | undefined;
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
    modelResolver,
  } = config;

  // Track the branch from the last step so work can be chained
  let lastBranch = baseBranch;

  return async (
    step: Step,
    prompt: string,
    variables: Map<string, unknown>
  ): Promise<AdapterResponse> => {
    const agentName = step.agent ?? 'copilot';

    // 1. Create issue and assign to Copilot cloud agent in a single call.
    //    Per GitHub docs: POST /repos/{owner}/{repo}/issues supports both
    //    `assignees` and `agent_assignment` fields directly.
    //    See: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/start-copilot-sessions#using-the-rest-api
    onProgress?.(step.id, `Creating issue for step "${step.id}" → agent "${agentName}"...`);

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
        base_branch: lastBranch,
        custom_instructions: prompt,
        custom_agent: agentName !== 'copilot' ? agentName : '',
        model: modelResolver?.(agentName) ?? '',
      },
    });

    onProgress?.(step.id, `Issue #${issue.number} created and assigned. Polling for completion...`);

    // 2. Poll for completion — watch for a PR linked to this issue
    const session = await pollForCompletion({
      octokit,
      owner,
      repo,
      issueNumber: issue.number,
      pollIntervalMs,
      timeoutMs,
      onProgress: (msg) => onProgress?.(step.id, msg),
    });

    // 3. Parse the result
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
    // Strategy 1: Check timeline for cross-referenced or connected events
    if (!session.prNumber) {
      const { data: events } = await octokit.issues.listEventsForTimeline({
        owner,
        repo,
        issue_number: issueNumber,
      });

      for (const event of events) {
        // cross-referenced: contains the PR directly
        if (
          event.event === 'cross-referenced' &&
          'source' in event &&
          (event as any).source?.issue?.pull_request
        ) {
          const linkedPR = (event as any).source.issue;
          session.prNumber = linkedPR.number;
          session.prUrl = linkedPR.html_url;
          session.status = 'working';
          break;
        }
      }

      // Strategy 2: If a "connected" event exists (Copilot agent links PRs this way)
      // but doesn't embed the PR number, search for open PRs referencing this issue
      const hasConnected = events.some((e) => e.event === 'connected');
      if (!session.prNumber && hasConnected) {
        const { data: prs } = await octokit.pulls.list({
          owner,
          repo,
          state: 'open',
          sort: 'created',
          direction: 'desc',
          per_page: 10,
        });

        // Find the PR whose body mentions this issue or was created by the bot
        for (const pr of prs) {
          const mentionsIssue =
            pr.body?.includes(`#${issueNumber}`) || pr.body?.includes(`issues/${issueNumber}`);
          const byBot = pr.user?.type === 'Bot';

          if (mentionsIssue || byBot) {
            session.prNumber = pr.number;
            session.prUrl = pr.html_url;
            session.prBranch = pr.head.ref;
            session.status = 'working';
            break;
          }
        }
      }
    }

    // If we found a PR, check if the agent is done
    if (session.prNumber) {
      const { data: pr } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: session.prNumber,
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

    onProgress?.(
      `Still waiting... (PR: ${session.prNumber ? `#${session.prNumber}` : 'not yet created'})`
    );
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

  const changedFiles = files.map(
    (f) => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`
  );

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
