import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCloudAgentExecutor, type CloudAgentConfig } from '../src/cloud-agent-executor.js';
import type { Step } from '@aoml/core';

// ---------------------------------------------------------------------------
// Mock Octokit
// ---------------------------------------------------------------------------

function createMockOctokit(overrides?: {
  prReady?: boolean;
  prBody?: string;
  files?: Array<{ status: string; filename: string; additions: number; deletions: number }>;
  closedWithoutPR?: boolean;
}) {
  const opts = {
    prReady: true,
    prBody: 'Implemented the feature',
    files: [{ status: 'modified', filename: 'src/auth.ts', additions: 10, deletions: 2 }],
    closedWithoutPR: false,
    ...overrides,
  };

  let pollCount = 0;

  return {
    issues: {
      create: vi.fn().mockResolvedValue({
        data: {
          number: 42,
          html_url: 'https://github.com/test-owner/test-repo/issues/42',
        },
      }),
      addAssignees: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockImplementation(() => ({
        data: {
          state: opts.closedWithoutPR ? 'closed' : 'open',
        },
      })),
      listEventsForTimeline: vi.fn().mockImplementation(() => {
        pollCount++;
        // Simulate: first poll has no PR, second poll has cross-reference
        if (pollCount <= 1 && !opts.closedWithoutPR) {
          return { data: [] };
        }
        if (opts.closedWithoutPR) {
          return { data: [] };
        }
        return {
          data: [
            {
              event: 'cross-referenced',
              source: {
                issue: {
                  number: 100,
                  html_url: 'https://github.com/test-owner/test-repo/pull/100',
                  pull_request: {},
                },
              },
            },
          ],
        };
      }),
    },
    pulls: {
      get: vi.fn().mockResolvedValue({
        data: {
          title: 'feat: implement auth',
          body: opts.prBody,
          head: { ref: 'copilot/step-auth' },
          state: 'open',
          merged: false,
          requested_reviewers: opts.prReady ? [{ login: 'test-user' }] : [],
        },
      }),
      listFiles: vi.fn().mockResolvedValue({
        data: opts.files,
      }),
    },
    request: vi.fn().mockResolvedValue({}),
  };
}

function makeStep(overrides?: Partial<Step>): Step {
  return {
    id: 'step-auth',
    agent: 'developer',
    input: { text: 'Implement authentication module', format: 'text' },
    output: { saveAs: 'auth_result' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CloudAgentExecutor', () => {
  it('creates issue and assigns to cloud agent', async () => {
    const octokit = createMockOctokit();
    const executor = createCloudAgentExecutor({
      octokit: octokit as any,
      owner: 'test-owner',
      repo: 'test-repo',
      pollIntervalMs: 10, // fast for tests
    });

    const result = await executor(makeStep(), 'Implement auth', new Map());

    expect(octokit.issues.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-owner',
        repo: 'test-repo',
        title: expect.stringContaining('step-auth'),
        labels: ['aoml-orchestration'],
      })
    );

    expect(octokit.issues.addAssignees).toHaveBeenCalledWith(
      expect.objectContaining({
        assignees: ['copilot-swe-agent[bot]'],
      })
    );

    expect(result.status).toBe('success');
    expect(result.extractedData).toContain('PR #100');
    expect(result.extractedData).toContain('src/auth.ts');
  });

  it('polls until PR has reviewers requested', async () => {
    const octokit = createMockOctokit();
    const progress: string[] = [];

    const executor = createCloudAgentExecutor({
      octokit: octokit as any,
      owner: 'test-owner',
      repo: 'test-repo',
      pollIntervalMs: 10,
      onProgress: (_id, msg) => progress.push(msg),
    });

    await executor(makeStep(), 'Implement auth', new Map());

    // Should have polled at least twice (first: no PR, second: PR found)
    expect(octokit.issues.listEventsForTimeline).toHaveBeenCalledTimes(2);
    expect(progress.some((p) => p.includes('Creating issue'))).toBe(true);
    expect(progress.some((p) => p.includes('completed'))).toBe(true);
  });

  it('returns failure when issue closed without PR', async () => {
    const octokit = createMockOctokit({ closedWithoutPR: true });

    const executor = createCloudAgentExecutor({
      octokit: octokit as any,
      owner: 'test-owner',
      repo: 'test-repo',
      pollIntervalMs: 10,
    });

    const result = await executor(makeStep(), 'Implement auth', new Map());

    expect(result.status).toBe('fail');
    expect(result.extractedData).toContain('failed');
  });

  it('chains branches across steps', async () => {
    const octokit = createMockOctokit();

    const executor = createCloudAgentExecutor({
      octokit: octokit as any,
      owner: 'test-owner',
      repo: 'test-repo',
      baseBranch: 'main',
      pollIntervalMs: 10,
    });

    // Step 1
    await executor(makeStep({ id: 'step-1' }), 'Step 1', new Map());

    // Step 2 should use step-1's PR branch as base
    await executor(makeStep({ id: 'step-2' }), 'Step 2', new Map());

    // The second PATCH call should reference the PR branch from step 1
    const patchCalls = octokit.request.mock.calls;
    expect(patchCalls.length).toBe(2);

    // First call uses baseBranch "main"
    expect((patchCalls[0][1] as any).agent_assignment.base_branch).toBe('main');
    // Second call uses the PR branch from step 1
    expect((patchCalls[1][1] as any).agent_assignment.base_branch).toBe('copilot/step-auth');
  });

  it('passes variables in issue body', async () => {
    const octokit = createMockOctokit();

    const executor = createCloudAgentExecutor({
      octokit: octokit as any,
      owner: 'test-owner',
      repo: 'test-repo',
      pollIntervalMs: 10,
    });

    const vars = new Map<string, unknown>([
      ['file_path', 'src/auth.ts'],
      ['priority', 'high'],
    ]);

    await executor(makeStep(), 'Implement auth', vars);

    const createCall = octokit.issues.create.mock.calls[0][0];
    expect(createCall.body).toContain('file_path');
    expect(createCall.body).toContain('src/auth.ts');
    expect(createCall.body).toContain('priority');
    expect(createCall.body).toContain('high');
  });
});
