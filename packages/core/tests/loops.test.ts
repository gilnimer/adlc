import { describe, it, expect, vi } from 'vitest';
import { Engine, type StepExecutor } from '../src/engine.js';
import { parseAoml } from '../src/parser.js';

const LOOP_WORKFLOW = `
<process name="loop-flow" type="workflow">
  <globals>
    <var name="files" required="true" />
  </globals>
  <steps>
    <step id="review-files" agent="qa">
      <input format="text">Review file: $\{{file}}</input>
      <output save_as="review_results" />
      <loop source="files" as="file" mode="sequential" />
      <routing>
        <on-status value="success" goto="done" />
        <on-status value="fail" goto="fix" />
      </routing>
    </step>
    <step id="fix" agent="developer">
      <input>Fix issues</input>
      <output save_as="fix_output" />
    </step>
    <step id="done" agent="principal">
      <input>All reviews passed</input>
      <output save_as="final" />
    </step>
  </steps>
</process>
`;

const PARALLEL_LOOP_WORKFLOW = `
<process name="parallel-flow" type="workflow">
  <globals>
    <var name="items" required="true" />
  </globals>
  <steps>
    <step id="process-items" agent="worker">
      <input format="text">Process: $\{{item}}</input>
      <output save_as="processed" />
      <loop source="items" as="item" mode="parallel" />
      <routing>
        <on-status value="success" goto="done" />
        <on-status value="fail" goto="done" />
      </routing>
    </step>
    <step id="done" agent="principal">
      <input>Complete</input>
      <output save_as="final" />
    </step>
  </steps>
</process>
`;

describe('Engine — Loops', () => {
  it('executes sequential loop over array items', async () => {
    const process = parseAoml(LOOP_WORKFLOW);
    const calls: string[] = [];

    const executor: StepExecutor = vi.fn(async (step, prompt) => {
      calls.push(prompt);
      if (step.id === 'review-files') return { status: 'success', extractedData: 'ok' };
      return { status: 'success', extractedData: 'done' };
    });

    const engine = new Engine({
      process,
      variables: { files: ['auth.ts', 'db.ts', 'api.ts'] },
      stepExecutor: executor,
    });

    const state = await engine.run();

    // Loop should call executor 3 times for the loop step
    expect(calls.filter((c) => c.startsWith('Review file:'))).toHaveLength(3);
    expect(calls).toContain('Review file: auth.ts');
    expect(calls).toContain('Review file: db.ts');
    expect(calls).toContain('Review file: api.ts');
    expect(state.executionTrace[0].status).toBe('success');
  });

  it('executes parallel loop concurrently', async () => {
    const process = parseAoml(PARALLEL_LOOP_WORKFLOW);
    const callOrder: number[] = [];
    let counter = 0;

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'process-items') {
        const idx = counter++;
        callOrder.push(idx);
        return { status: 'success', extractedData: `result-${idx}` };
      }
      return { status: 'success', extractedData: 'final' };
    });

    const engine = new Engine({
      process,
      variables: { items: ['a', 'b', 'c'] },
      stepExecutor: executor,
    });

    const state = await engine.run();
    expect(state.executionTrace[0].status).toBe('success');

    // All 3 items should be processed
    const parsedData = JSON.parse(state.executionTrace[0].rawOutput);
    expect(parsedData).toHaveLength(3);
  });

  it('handles partial failures in parallel loop', async () => {
    const process = parseAoml(PARALLEL_LOOP_WORKFLOW);
    let idx = 0;

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'process-items') {
        idx++;
        if (idx === 2) throw new Error('item 2 failed');
        return { status: 'success', extractedData: `ok-${idx}` };
      }
      return { status: 'success', extractedData: 'done' };
    });

    const engine = new Engine({
      process,
      variables: { items: ['x', 'y', 'z'] },
      stepExecutor: executor,
    });

    const state = await engine.run();
    // Overall should be 'fail' because one item failed
    expect(state.executionTrace[0].status).toBe('fail');
  });
});
