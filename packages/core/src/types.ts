/**
 * AOML AST Type Definitions
 * Matches TSD §5.3 — AOML Supported Tags Reference
 */

export interface Process {
  name: string;
  type: 'workflow' | 'pipeline';
  trigger?: Trigger;
  globals?: Globals;
  steps: Step[];
  postProcess?: PostProcess;
}

export interface Trigger {
  type: 'manual' | 'schedule' | 'webhook';
}

export interface Globals {
  vars: Var[];
}

export interface Var {
  name: string;
  required: boolean;
}

export interface Step {
  id: string;
  agent?: string;
  type?: 'subflow';
  src?: string;
  input?: Input;
  output?: Output;
  routing?: Routing;
  loop?: Loop;
}

export interface Input {
  format?: 'text' | 'json';
  mapTo?: string;
  text: string;
}

export interface Output {
  saveAs: string;
}

export interface Routing {
  onStatus: OnStatus[];
  onError?: OnError;
  onMaxRetries?: OnMaxRetries;
}

export interface OnStatus {
  value: string;
  goto: string;
  passFeedback?: boolean;
}

export interface OnError {
  goto: string;
  retryCount: number;
}

export interface OnMaxRetries {
  goto: string;
}

export interface Loop {
  source: string;
  as: string;
  mode: 'parallel' | 'sequential';
}

export interface PostProcess {
  evaluations: Evaluate[];
}

export interface Evaluate {
  agent: string;
  prompt: string;
}

// Engine State (TSD §5.1)
export interface EngineState {
  processName: string;
  currentStepId: string;
  variables: Map<string, unknown>;
  callStack: CallStackFrame[];
  executionTrace: TraceEntry[];
}

export interface CallStackFrame {
  parentProcessName: string;
  returnStepId: string;
  variableContext: Map<string, unknown>;
}

export interface TraceEntry {
  stepId: string;
  agent: string;
  status: 'success' | 'fail' | 'approve' | 'reject' | 'escalated';
  latencyMs: number;
  tokensUsed: number;
  rawOutput: string;
  subTrace?: TraceEntry[];
}

// Adapter Response (TSD §5.4)
export interface AdapterResponse {
  status: string;
  extractedData: string;
}
