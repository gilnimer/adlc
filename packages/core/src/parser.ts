import { XMLParser } from 'fast-xml-parser';
import type {
  Process,
  Step,
  Input,
  Output,
  Routing,
  OnStatus,
  OnError,
  OnMaxRetries,
  Loop,
  Trigger,
  Globals,
  Var,
  PostProcess,
  Evaluate,
} from './types.js';
import { ProcessSchema } from './schemas.js';
import { ZodError } from 'zod';

export class AomlParseError extends Error {
  constructor(
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AomlParseError';
  }
}

/**
 * Parse an AOML XML string into a validated Process AST.
 */
export function parseAoml(xml: string): Process {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    isArray: (name) => ['step', 'var', 'on-status', 'evaluate'].includes(name),
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new AomlParseError('Failed to parse XML', err);
  }

  const rawProcess = (parsed as Record<string, unknown>)['process'] as
    | Record<string, unknown>
    | undefined;
  if (!rawProcess) {
    throw new AomlParseError('Missing root <process> element');
  }

  const process = transformProcess(rawProcess);

  // Validate with Zod
  try {
    ProcessSchema.parse(process);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new AomlParseError('AOML validation failed', err.errors);
    }
    throw err;
  }

  // Validate routing graph references
  validateRoutingGraph(process);

  return process;
}

function transformProcess(raw: Record<string, unknown>): Process {
  const process: Process = {
    name: getAttr(raw, 'name') ?? '',
    type: (getAttr(raw, 'type') as 'workflow' | 'pipeline') ?? 'workflow',
    steps: [],
  };

  if (raw['trigger']) {
    process.trigger = transformTrigger(raw['trigger'] as Record<string, unknown>);
  }

  if (raw['globals']) {
    process.globals = transformGlobals(raw['globals'] as Record<string, unknown>);
  }

  const stepsContainer = raw['steps'] as Record<string, unknown> | undefined;
  if (stepsContainer && stepsContainer['step']) {
    const steps = Array.isArray(stepsContainer['step'])
      ? stepsContainer['step']
      : [stepsContainer['step']];
    process.steps = steps.map((s) => transformStep(s as Record<string, unknown>));
  }

  if (raw['post-process']) {
    process.postProcess = transformPostProcess(raw['post-process'] as Record<string, unknown>);
  }

  return process;
}

function transformTrigger(raw: Record<string, unknown>): Trigger {
  return {
    type: (getAttr(raw, 'type') as 'manual' | 'schedule' | 'webhook') ?? 'manual',
  };
}

function transformGlobals(raw: Record<string, unknown>): Globals {
  const vars = Array.isArray(raw['var']) ? raw['var'] : raw['var'] ? [raw['var']] : [];
  return {
    vars: vars.map((v) => transformVar(v as Record<string, unknown>)),
  };
}

function transformVar(raw: Record<string, unknown>): Var {
  return {
    name: getAttr(raw, 'name') ?? '',
    required: getAttr(raw, 'required') === 'true',
  };
}

function transformStep(raw: Record<string, unknown>): Step {
  const step: Step = {
    id: getAttr(raw, 'id') ?? '',
    agent: getAttr(raw, 'agent') ?? undefined,
    type: getAttr(raw, 'type') === 'subflow' ? 'subflow' : undefined,
    src: getAttr(raw, 'src') ?? undefined,
  };

  if (raw['input']) {
    step.input = transformInput(raw['input'] as Record<string, unknown>);
  }

  if (raw['output']) {
    step.output = transformOutput(raw['output'] as Record<string, unknown>);
  }

  if (raw['routing']) {
    step.routing = transformRouting(raw['routing'] as Record<string, unknown>);
  }

  if (raw['loop']) {
    step.loop = transformLoop(raw['loop'] as Record<string, unknown>);
  }

  return step;
}

function transformInput(raw: Record<string, unknown>): Input {
  return {
    format: (getAttr(raw, 'format') as 'text' | 'json') ?? undefined,
    mapTo: getAttr(raw, 'map_to') ?? undefined,
    text: typeof raw['#text'] === 'string' ? raw['#text'] : String(raw['#text'] ?? ''),
  };
}

function transformOutput(raw: Record<string, unknown>): Output {
  return {
    saveAs: getAttr(raw, 'save_as') ?? '',
  };
}

function transformRouting(raw: Record<string, unknown>): Routing {
  const onStatusRaw = Array.isArray(raw['on-status'])
    ? raw['on-status']
    : raw['on-status']
      ? [raw['on-status']]
      : [];

  const routing: Routing = {
    onStatus: onStatusRaw.map((os) => transformOnStatus(os as Record<string, unknown>)),
  };

  if (raw['on-error']) {
    routing.onError = transformOnError(raw['on-error'] as Record<string, unknown>);
  }

  if (raw['on-max-retries']) {
    routing.onMaxRetries = transformOnMaxRetries(raw['on-max-retries'] as Record<string, unknown>);
  }

  return routing;
}

function transformOnStatus(raw: Record<string, unknown>): OnStatus {
  return {
    value: getAttr(raw, 'value') ?? '',
    goto: getAttr(raw, 'goto') ?? '',
    passFeedback: getAttr(raw, 'pass_feedback') === 'true' ? true : undefined,
  };
}

function transformOnError(raw: Record<string, unknown>): OnError {
  return {
    goto: getAttr(raw, 'goto') ?? '',
    retryCount: parseInt(getAttr(raw, 'retry_count') ?? '0', 10),
  };
}

function transformOnMaxRetries(raw: Record<string, unknown>): OnMaxRetries {
  return {
    goto: getAttr(raw, 'goto') ?? '',
  };
}

function transformLoop(raw: Record<string, unknown>): Loop {
  return {
    source: getAttr(raw, 'source') ?? '',
    as: getAttr(raw, 'as') ?? '',
    mode: (getAttr(raw, 'mode') as 'parallel' | 'sequential') ?? 'sequential',
  };
}

function transformPostProcess(raw: Record<string, unknown>): PostProcess {
  const evals = Array.isArray(raw['evaluate'])
    ? raw['evaluate']
    : raw['evaluate']
      ? [raw['evaluate']]
      : [];
  return {
    evaluations: evals.map((e) => transformEvaluate(e as Record<string, unknown>)),
  };
}

function transformEvaluate(raw: Record<string, unknown>): Evaluate {
  return {
    agent: getAttr(raw, 'agent') ?? '',
    prompt: getAttr(raw, 'prompt') ?? '',
  };
}

function getAttr(obj: Record<string, unknown>, name: string): string | undefined {
  const val = obj[`@_${name}`];
  if (val === undefined || val === null) return undefined;
  return String(val);
}

/**
 * Validates that all routing `goto` targets reference existing step IDs.
 */
function validateRoutingGraph(process: Process): void {
  const stepIds = new Set(process.steps.map((s) => s.id));

  for (const step of process.steps) {
    if (!step.routing) continue;

    for (const onStatus of step.routing.onStatus) {
      if (!stepIds.has(onStatus.goto)) {
        throw new AomlParseError(
          `Step "${step.id}": on-status goto "${onStatus.goto}" references non-existent step`
        );
      }
    }

    if (step.routing.onError && !stepIds.has(step.routing.onError.goto)) {
      throw new AomlParseError(
        `Step "${step.id}": on-error goto "${step.routing.onError.goto}" references non-existent step`
      );
    }

    if (step.routing.onMaxRetries && !stepIds.has(step.routing.onMaxRetries.goto)) {
      throw new AomlParseError(
        `Step "${step.id}": on-max-retries goto "${step.routing.onMaxRetries.goto}" references non-existent step`
      );
    }
  }
}
