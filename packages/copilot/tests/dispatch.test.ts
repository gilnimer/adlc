import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { dispatch, formatTraceAsMarkdown } from '../src/index.js';

const WORKSPACE = resolve(import.meta.dirname, '../../../');

describe('Copilot Dispatcher — code-review workflow', () => {
  it('resolves "review" intent to code-review workflow', async () => {
    const response = await dispatch({
      intent: 'review my code',
      workflowFile: '.github/workflows/code-review.xml',
      variables: { file_path: 'src/auth.ts' },
      workspacePath: WORKSPACE,
    });

    expect(response.state.processName).toBe('code-review');
    expect(response.state.executionTrace.length).toBeGreaterThan(0);
    expect(response.markdown).toContain('code-review');
  });

  it('prompts for missing required variables', async () => {
    const response = await dispatch({
      intent: 'review',
      workflowFile: '.github/workflows/code-review.xml',
      variables: {},
      workspacePath: WORKSPACE,
    });

    expect(response.markdown).toContain('file_path');
    expect(response.markdown).toContain('please provide');
  });

  it('executes full workflow and returns markdown trace', async () => {
    const response = await dispatch({
      intent: 'review',
      workflowFile: '.github/workflows/code-review.xml',
      variables: { file_path: 'packages/core/src/parser.ts' },
      workspacePath: WORKSPACE,
    });

    // Mock executor returns "success" — which doesn't match "approve"/"reject" routing,
    // so engine stops after analyze (terminal state with no matching route).
    const stepIds = response.state.executionTrace.map((t) => t.stepId);
    expect(stepIds).toContain('analyze');
    expect(response.state.executionTrace[0].status).toBe('success');

    // Markdown output should be formatted
    expect(response.markdown).toContain('✅');
    expect(response.markdown).toContain('analyze');
  });

  it('returns error for unresolvable intent without explicit file', async () => {
    const response = await dispatch({
      intent: 'do something random',
      variables: {},
      workspacePath: WORKSPACE,
    });

    expect(response.markdown).toContain('❌');
    expect(response.markdown).toContain('Could not resolve workflow');
  });

  it('formats trace as collapsible markdown', () => {
    const state = {
      processName: 'test-flow',
      currentStepId: 'done',
      variables: new Map(),
      callStack: [],
      executionTrace: [
        {
          stepId: 'step1',
          agent: 'qa',
          status: 'approve' as const,
          latencyMs: 120,
          tokensUsed: 500,
          rawOutput: 'looks good',
        },
        {
          stepId: 'step2',
          agent: 'dev',
          status: 'success' as const,
          latencyMs: 450,
          tokensUsed: 1200,
          rawOutput: 'code written',
        },
      ],
    };

    const md = formatTraceAsMarkdown(state);
    expect(md).toContain('## 🔄 test-flow');
    expect(md).toContain('✅');
    expect(md).toContain('step1');
    expect(md).toContain('step2');
    expect(md).toContain('120ms');
  });
});
