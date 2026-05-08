import { describe, it, expect, vi } from 'vitest';
import { Engine, type StepExecutor } from '../src/engine.js';
import { parseAoml } from '../src/parser.js';

const WORKFLOW_WITH_POSTPROCESS = `
<process name="graded-flow" type="workflow">
  <steps>
    <step id="work" agent="developer">
      <input>Build feature</input>
      <output save_as="work_output" />
    </step>
  </steps>
  <post-process>
    <evaluate agent="meta-qa" prompt="prompts/grade.md" />
    <evaluate agent="meta-security" prompt="prompts/security-audit.md" />
  </post-process>
</process>
`;

describe('Engine — Post-Process & Telemetry', () => {
  it('executes post-process evaluations after main steps', async () => {
    const process = parseAoml(WORKFLOW_WITH_POSTPROCESS);

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'work') return { status: 'success', extractedData: 'feature code' };
      if (step.id === 'post-process:meta-qa')
        return { status: 'success', extractedData: 'Grade: A' };
      if (step.id === 'post-process:meta-security')
        return { status: 'success', extractedData: 'No issues' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: {},
      stepExecutor: executor,
    });

    const state = await engine.run();

    expect(state.executionTrace).toHaveLength(3);
    expect(state.executionTrace[0].stepId).toBe('work');
    expect(state.executionTrace[1].stepId).toBe('post-process:meta-qa');
    expect(state.executionTrace[2].stepId).toBe('post-process:meta-security');
    expect(state.variables.get('_eval_meta-qa')).toBe('Grade: A');
    expect(state.variables.get('_eval_meta-security')).toBe('No issues');
  });

  it('continues post-process even if one evaluation fails', async () => {
    const process = parseAoml(WORKFLOW_WITH_POSTPROCESS);

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'work') return { status: 'success', extractedData: 'code' };
      if (step.id === 'post-process:meta-qa') throw new Error('Grading failed');
      if (step.id === 'post-process:meta-security')
        return { status: 'success', extractedData: 'Safe' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: {},
      stepExecutor: executor,
    });

    const state = await engine.run();

    expect(state.executionTrace).toHaveLength(3);
    expect(state.executionTrace[1].status).toBe('fail');
    expect(state.executionTrace[2].status).toBe('success');
  });

  it('generates structured execution trace with latency', async () => {
    const process = parseAoml(WORKFLOW_WITH_POSTPROCESS);

    const executor: StepExecutor = vi.fn(async (step) => {
      return { status: 'success', extractedData: `result for ${step.id}` };
    });

    const engine = new Engine({
      process,
      variables: {},
      stepExecutor: executor,
    });

    const state = await engine.run();

    for (const entry of state.executionTrace) {
      expect(entry.stepId).toBeTruthy();
      expect(entry.agent).toBeTruthy();
      expect(entry.status).toBe('success');
      expect(typeof entry.latencyMs).toBe('number');
      expect(entry.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof entry.rawOutput).toBe('string');
    }
  });

  it('passes full trace to post-process evaluator prompt', async () => {
    const process = parseAoml(WORKFLOW_WITH_POSTPROCESS);
    const receivedPrompts: string[] = [];

    const executor: StepExecutor = vi.fn(async (step, prompt) => {
      receivedPrompts.push(prompt);
      if (step.id === 'work') return { status: 'success', extractedData: 'feature' };
      return { status: 'success', extractedData: 'evaluated' };
    });

    const engine = new Engine({
      process,
      variables: {},
      stepExecutor: executor,
    });

    await engine.run();

    // Post-process prompts should contain the trace
    const evalPrompt = receivedPrompts[1];
    expect(evalPrompt).toContain('execution trace');
    expect(evalPrompt).toContain('prompts/grade.md');
    expect(evalPrompt).toContain('work');
  });
});
