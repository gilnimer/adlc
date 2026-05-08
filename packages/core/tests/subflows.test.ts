import { describe, it, expect, vi } from 'vitest';
import { Engine, type StepExecutor, type SubFlowLoader } from '../src/engine.js';
import { parseAoml } from '../src/parser.js';
import type { Process } from '../src/types.js';

const PARENT_WORKFLOW = `
<process name="parent-flow" type="workflow">
  <globals>
    <var name="code" required="true" />
  </globals>
  <steps>
    <step id="audit" type="subflow" src="modules/security.xml">
      <input map_to="code_to_audit">$\{{code}}</input>
      <output save_as="audit_result" />
      <routing>
        <on-status value="success" goto="deploy" />
        <on-status value="fail" goto="fix" />
      </routing>
    </step>
    <step id="deploy" agent="principal">
      <input>Deploy: $\{{audit_result}}</input>
      <output save_as="deploy_output" />
    </step>
    <step id="fix" agent="developer">
      <input>Fix issues from audit</input>
      <output save_as="fix_output" />
    </step>
  </steps>
</process>
`;

const CHILD_WORKFLOW = `
<process name="security-audit" type="pipeline">
  <globals>
    <var name="code_to_audit" required="true" />
  </globals>
  <steps>
    <step id="scan" agent="security-scanner">
      <input format="text">Scan: $\{{code_to_audit}}</input>
      <output save_as="scan_result" />
      <routing>
        <on-status value="success" goto="report" />
        <on-status value="fail" goto="report" />
      </routing>
    </step>
    <step id="report" agent="security-reporter">
      <input>Generate report from $\{{scan_result}}</input>
      <output save_as="final_report" />
    </step>
  </steps>
</process>
`;

describe('Engine — Sub-Flows', () => {
  it('executes sub-flow with variable mapping', async () => {
    const parentProcess = parseAoml(PARENT_WORKFLOW);
    const childProcess = parseAoml(CHILD_WORKFLOW);

    const subFlowLoader: SubFlowLoader = vi.fn(async (src) => {
      expect(src).toBe('modules/security.xml');
      return childProcess;
    });

    const executor: StepExecutor = vi.fn(async (step, prompt) => {
      if (step.id === 'scan') {
        expect(prompt).toContain('const auth = {}');
        return { status: 'success', extractedData: 'no vulnerabilities' };
      }
      if (step.id === 'report') {
        return { status: 'success', extractedData: 'Security audit passed' };
      }
      if (step.id === 'deploy') {
        return { status: 'success', extractedData: 'Deployed' };
      }
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process: parentProcess,
      variables: { code: 'const auth = {}' },
      stepExecutor: executor,
      subFlowLoader,
    });

    const state = await engine.run();

    // audit (subflow) → deploy
    expect(state.executionTrace.map((t) => t.stepId)).toEqual(['audit', 'deploy']);
    expect(state.executionTrace[0].status).toBe('success');
    expect(state.variables.get('audit_result')).toBe('Security audit passed');
  });

  it('routes parent based on sub-flow failure', async () => {
    const parentProcess = parseAoml(PARENT_WORKFLOW);
    const childProcess = parseAoml(CHILD_WORKFLOW);

    const subFlowLoader: SubFlowLoader = vi.fn(async () => childProcess);

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'scan') return { status: 'fail', extractedData: 'SQL injection found' };
      if (step.id === 'report') return { status: 'fail', extractedData: 'Critical issues' };
      if (step.id === 'fix') return { status: 'success', extractedData: 'Fixed' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process: parentProcess,
      variables: { code: 'vulnerable code' },
      stepExecutor: executor,
      subFlowLoader,
    });

    const state = await engine.run();

    // audit (fail) → fix
    expect(state.executionTrace.map((t) => t.stepId)).toEqual(['audit', 'fix']);
    expect(state.executionTrace[0].status).toBe('fail');
  });

  it('pushes and pops call stack correctly', async () => {
    const parentProcess = parseAoml(PARENT_WORKFLOW);
    const childProcess = parseAoml(CHILD_WORKFLOW);

    const subFlowLoader: SubFlowLoader = vi.fn(async () => childProcess);

    const executor: StepExecutor = vi.fn(async (step) => {
      if (step.id === 'scan') return { status: 'success', extractedData: 'clean' };
      if (step.id === 'report') return { status: 'success', extractedData: 'all good' };
      if (step.id === 'deploy') return { status: 'success', extractedData: 'deployed' };
      return { status: 'success', extractedData: '' };
    });

    const engine = new Engine({
      process: parentProcess,
      variables: { code: 'safe code' },
      stepExecutor: executor,
      subFlowLoader,
    });

    const state = await engine.run();

    // Call stack should be empty after completion
    expect(state.callStack).toHaveLength(0);
  });

  it('records failure when no subFlowLoader provided', async () => {
    const parentProcess = parseAoml(PARENT_WORKFLOW);

    const executor: StepExecutor = vi.fn(async () => ({ status: 'success', extractedData: '' }));

    const engine = new Engine({
      process: parentProcess,
      variables: { code: 'test' },
      stepExecutor: executor,
    });

    const state = await engine.run();
    expect(state.executionTrace[0].status).toBe('fail');
    expect(state.executionTrace[0].rawOutput).toContain('No subFlowLoader provided');
  });
});
