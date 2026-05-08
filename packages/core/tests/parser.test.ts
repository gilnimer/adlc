import { describe, it, expect } from 'vitest';
import { parseAoml, AomlParseError } from '../src/parser.js';
import type { Process } from '../src/types.js';

const MINIMAL_WORKFLOW = `
<process name="test-flow" type="workflow">
  <trigger type="manual" />
  <globals>
    <var name="ticket_id" required="true" />
  </globals>
  <steps>
    <step id="plan" agent="principal">
      <input format="text">Plan the work for $\{{ticket_id}}</input>
      <output save_as="plan_output" />
      <routing>
        <on-status value="success" goto="implement" />
        <on-status value="fail" goto="plan" pass_feedback="true" />
        <on-error goto="plan" retry_count="2" />
        <on-max-retries goto="escalate" />
      </routing>
    </step>
    <step id="implement" agent="developer">
      <input format="text">Implement: $\{{plan_output}}</input>
      <output save_as="code_output" />
      <routing>
        <on-status value="success" goto="review" />
        <on-error goto="implement" retry_count="3" />
        <on-max-retries goto="escalate" />
      </routing>
    </step>
    <step id="review" agent="qa">
      <input format="text">Review: $\{{code_output}}</input>
      <output save_as="review_result" />
      <routing>
        <on-status value="approve" goto="done" />
        <on-status value="reject" goto="implement" pass_feedback="true" />
        <on-error goto="escalate" retry_count="1" />
        <on-max-retries goto="escalate" />
      </routing>
    </step>
    <step id="done" agent="principal">
      <input>Finalize delivery.</input>
      <output save_as="final_output" />
    </step>
    <step id="escalate" agent="principal">
      <input>Escalation required.</input>
      <output save_as="escalation_output" />
    </step>
  </steps>
</process>
`;

describe('AOML Parser', () => {
  it('parses a minimal workflow into a valid Process AST', () => {
    const result = parseAoml(MINIMAL_WORKFLOW);

    expect(result.name).toBe('test-flow');
    expect(result.type).toBe('workflow');
    expect(result.trigger?.type).toBe('manual');
    expect(result.globals?.vars).toHaveLength(1);
    expect(result.globals?.vars[0].name).toBe('ticket_id');
    expect(result.globals?.vars[0].required).toBe(true);
    expect(result.steps).toHaveLength(5);
  });

  it('parses step attributes correctly', () => {
    const result = parseAoml(MINIMAL_WORKFLOW);
    const plan = result.steps[0];

    expect(plan.id).toBe('plan');
    expect(plan.agent).toBe('principal');
    expect(plan.input?.format).toBe('text');
    expect(plan.input?.text).toContain('${{ticket_id}}');
    expect(plan.output?.saveAs).toBe('plan_output');
  });

  it('parses routing with on-status, on-error, on-max-retries', () => {
    const result = parseAoml(MINIMAL_WORKFLOW);
    const plan = result.steps[0];

    expect(plan.routing?.onStatus).toHaveLength(2);
    expect(plan.routing?.onStatus[0]).toEqual({
      value: 'success',
      goto: 'implement',
      passFeedback: undefined,
    });
    expect(plan.routing?.onStatus[1]).toEqual({
      value: 'fail',
      goto: 'plan',
      passFeedback: true,
    });
    expect(plan.routing?.onError).toEqual({ goto: 'plan', retryCount: 2 });
    expect(plan.routing?.onMaxRetries).toEqual({ goto: 'escalate' });
  });

  it('throws AomlParseError on invalid XML', () => {
    expect(() => parseAoml('<not-a-process />')).toThrow(AomlParseError);
  });

  it('throws on non-existent goto target', () => {
    const badXml = `
    <process name="bad" type="workflow">
      <steps>
        <step id="start" agent="test">
          <input>Hello</input>
          <output save_as="x" />
          <routing>
            <on-status value="success" goto="nonexistent" />
          </routing>
        </step>
      </steps>
    </process>`;
    expect(() => parseAoml(badXml)).toThrow('non-existent step');
  });

  it('parses subflow steps', () => {
    const xml = `
    <process name="parent" type="workflow">
      <steps>
        <step id="audit" type="subflow" src="modules/security.xml">
          <input map_to="code_to_audit">some code</input>
          <output save_as="audit_result" />
          <routing>
            <on-status value="success" goto="done" />
          </routing>
        </step>
        <step id="done" agent="principal">
          <input>Done</input>
          <output save_as="final" />
        </step>
      </steps>
    </process>`;

    const result = parseAoml(xml);
    const audit = result.steps[0];
    expect(audit.type).toBe('subflow');
    expect(audit.src).toBe('modules/security.xml');
    expect(audit.input?.mapTo).toBe('code_to_audit');
  });

  it('parses post-process evaluations', () => {
    const xml = `
    <process name="with-eval" type="pipeline">
      <steps>
        <step id="work" agent="dev">
          <input>Do work</input>
          <output save_as="result" />
        </step>
      </steps>
      <post-process>
        <evaluate agent="meta-qa" prompt="prompts/grade.md" />
      </post-process>
    </process>`;

    const result = parseAoml(xml);
    expect(result.postProcess?.evaluations).toHaveLength(1);
    expect(result.postProcess?.evaluations[0].agent).toBe('meta-qa');
    expect(result.postProcess?.evaluations[0].prompt).toBe('prompts/grade.md');
  });
});
