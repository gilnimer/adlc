import { describe, it, expect, vi } from 'vitest';
import { Engine, type StepExecutor } from '../src/engine.js';
import { parseAoml } from '../src/parser.js';
import type { AdapterResponse } from '../src/types.js';

const SIMPLE_WORKFLOW = `
<process name="test-flow" type="workflow">
  <globals>
    <var name="ticket_id" required="true" />
  </globals>
  <steps>
    <step id="plan" agent="principal">
      <input format="text">Plan work for $\{{ticket_id}}</input>
      <output save_as="plan_output" />
      <routing>
        <on-status value="success" goto="implement" />
        <on-error goto="plan" retry_count="2" />
        <on-max-retries goto="escalate" />
      </routing>
    </step>
    <step id="implement" agent="developer">
      <input format="text">Implement: $\{{plan_output}}</input>
      <output save_as="code_output" />
      <routing>
        <on-status value="success" goto="done" />
        <on-status value="reject" goto="implement" pass_feedback="true" />
        <on-error goto="implement" retry_count="1" />
        <on-max-retries goto="escalate" />
      </routing>
    </step>
    <step id="done" agent="principal">
      <input>Finalize $\{{code_output}}</input>
      <output save_as="final" />
    </step>
    <step id="escalate" agent="principal">
      <input>Escalation needed</input>
      <output save_as="escalation" />
    </step>
  </steps>
</process>
`;

describe('Engine', () => {
  it('executes a linear workflow to completion', async () => {
    const process = parseAoml(SIMPLE_WORKFLOW);

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'plan') return { status: 'success', extractedData: 'Build auth module' };
      if (step.id === 'implement') return { status: 'success', extractedData: 'const auth = ...' };
      if (step.id === 'done') return { status: 'success', extractedData: 'Delivered' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: { ticket_id: 'PROJ-123' },
      stepExecutor: executor,
    });

    const finalState = await engine.run();

    expect(finalState.executionTrace).toHaveLength(3);
    expect(finalState.executionTrace[0].stepId).toBe('plan');
    expect(finalState.executionTrace[1].stepId).toBe('implement');
    expect(finalState.executionTrace[2].stepId).toBe('done');
    expect(finalState.variables.get('plan_output')).toBe('Build auth module');
    expect(finalState.variables.get('code_output')).toBe('const auth = ...');
    expect(finalState.variables.get('final')).toBe('Delivered');
  });

  it('routes based on status values', async () => {
    const process = parseAoml(SIMPLE_WORKFLOW);
    let callCount = 0;

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'plan') return { status: 'success', extractedData: 'plan' };
      if (step.id === 'implement') {
        callCount++;
        if (callCount === 1) return { status: 'reject', extractedData: 'needs fixes' };
        return { status: 'success', extractedData: 'fixed code' };
      }
      if (step.id === 'done') return { status: 'success', extractedData: 'done' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: { ticket_id: 'T-1' },
      stepExecutor: executor,
    });

    const finalState = await engine.run();

    // plan -> implement (reject) -> implement (success) -> done
    expect(finalState.executionTrace).toHaveLength(4);
    expect(finalState.executionTrace[0].stepId).toBe('plan');
    expect(finalState.executionTrace[1].stepId).toBe('implement');
    expect(finalState.executionTrace[1].status).toBe('reject');
    expect(finalState.executionTrace[2].stepId).toBe('implement');
    expect(finalState.executionTrace[2].status).toBe('success');
    expect(finalState.executionTrace[3].stepId).toBe('done');
  });

  it('handles error routing with retries', async () => {
    const process = parseAoml(SIMPLE_WORKFLOW);
    let planCalls = 0;

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'plan') {
        planCalls++;
        if (planCalls <= 2) throw new Error('LLM timeout');
        return { status: 'success', extractedData: 'plan' };
      }
      if (step.id === 'implement') return { status: 'success', extractedData: 'code' };
      if (step.id === 'done') return { status: 'success', extractedData: 'done' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: { ticket_id: 'T-2' },
      stepExecutor: executor,
    });

    const finalState = await engine.run();

    // plan (fail) -> plan (fail) -> plan (success) -> implement -> done
    expect(finalState.executionTrace.map((t) => t.stepId)).toEqual([
      'plan',
      'plan',
      'plan',
      'implement',
      'done',
    ]);
    expect(finalState.executionTrace[0].status).toBe('fail');
    expect(finalState.executionTrace[1].status).toBe('fail');
    expect(finalState.executionTrace[2].status).toBe('success');
  });

  it('escalates after max retries exhausted', async () => {
    const process = parseAoml(SIMPLE_WORKFLOW);

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'plan') throw new Error('always fails');
      if (step.id === 'escalate') return { status: 'escalated', extractedData: 'human needed' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: { ticket_id: 'T-3' },
      stepExecutor: executor,
    });

    const finalState = await engine.run();

    // plan fails 3 times (initial + 2 retries) then escalates
    expect(finalState.executionTrace.map((t) => t.stepId)).toEqual([
      'plan',
      'plan',
      'plan',
      'escalate',
    ]);
    expect(finalState.executionTrace[3].status).toBe('escalated');
  });

  it('stores variables from output save_as and resolves in next step', async () => {
    const process = parseAoml(SIMPLE_WORKFLOW);

    const executor: StepExecutor = vi.fn(async (step, prompt) => {
      if (step.id === 'plan') return { status: 'success', extractedData: 'THE PLAN' };
      if (step.id === 'implement') {
        // Verify the prompt was interpolated with plan_output
        expect(prompt).toBe('Implement: THE PLAN');
        return { status: 'success', extractedData: 'THE CODE' };
      }
      if (step.id === 'done') {
        expect(prompt).toBe('Finalize THE CODE');
        return { status: 'success', extractedData: 'FINAL' };
      }
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: { ticket_id: 'T-4' },
      stepExecutor: executor,
    });

    await engine.run();
    expect(executor).toHaveBeenCalledTimes(3);
  });

  it('emits events for observability', async () => {
    const process = parseAoml(SIMPLE_WORKFLOW);

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'plan') return { status: 'success', extractedData: 'plan' };
      if (step.id === 'implement') return { status: 'success', extractedData: 'code' };
      if (step.id === 'done') return { status: 'success', extractedData: 'done' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: { ticket_id: 'T-5' },
      stepExecutor: executor,
    });

    const starts: string[] = [];
    const completes: string[] = [];
    const routes: string[] = [];

    engine.events.on('step:start', (data) => starts.push(data.stepId));
    engine.events.on('step:complete', (data) => completes.push(data.stepId));
    engine.events.on('route:decision', (data) => routes.push(`${data.stepId}->${data.goto}`));

    await engine.run();

    expect(starts).toEqual(['plan', 'implement', 'done']);
    expect(completes).toEqual(['plan', 'implement', 'done']);
    expect(routes).toEqual(['plan->implement', 'implement->done']);
  });

  it('sets _feedback variable when pass_feedback is true', async () => {
    const process = parseAoml(SIMPLE_WORKFLOW);
    let implCount = 0;

    const executor: StepExecutor = vi.fn(async (step, _prompt, variables) => {
      if (step.id === 'plan') return { status: 'success', extractedData: 'plan' };
      if (step.id === 'implement') {
        implCount++;
        if (implCount === 1) return { status: 'reject', extractedData: 'fix the auth bug' };
        // On second call, _feedback should be set
        expect(variables.get('_feedback')).toBe('fix the auth bug');
        return { status: 'success', extractedData: 'fixed code' };
      }
      if (step.id === 'done') return { status: 'success', extractedData: 'done' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process,
      variables: { ticket_id: 'T-6' },
      stepExecutor: executor,
    });

    await engine.run();
  });
});
