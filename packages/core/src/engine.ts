import type { Process, Step, EngineState, TraceEntry, AdapterResponse } from './types.js';
import { interpolate } from './variables.js';
import { EngineEventEmitter, type EngineEvents } from './events.js';

export type StepExecutor = (
  step: Step,
  prompt: string,
  variables: Map<string, unknown>
) => Promise<AdapterResponse>;

export type SubFlowLoader = (src: string) => Process | Promise<Process>;

/**
 * What the engine yields to the surface for each step.
 * The surface delegates to the appropriate agent and feeds back a StepResult.
 */
export interface StepRequest {
  /** The step being executed */
  step: Step;
  /** The interpolated prompt (input adapter already applied) */
  prompt: string;
  /** Current engine variables snapshot */
  variables: ReadonlyMap<string, unknown>;
  /** Depth in the call stack (0 = top-level process) */
  depth: number;
}

/**
 * What the surface feeds back after an agent completes a step.
 */
export interface StepResult {
  /** The raw text output from the agent */
  rawOutput: string;
  /** Structured response after output adaptation */
  response: AdapterResponse;
  /** If the agent threw an error instead of returning */
  error?: unknown;
}

export interface EngineOptions {
  process: Process;
  variables?: Record<string, unknown>;
  stepExecutor: StepExecutor;
  subFlowLoader?: SubFlowLoader;
}

export class Engine {
  private state: EngineState;
  private process: Process;
  private stepMap: Map<string, Step>;
  private stepExecutor: StepExecutor;
  private subFlowLoader?: SubFlowLoader;
  private retryCounts: Map<string, number> = new Map();
  public events: EngineEventEmitter = new EngineEventEmitter();

  constructor(options: EngineOptions) {
    this.process = options.process;
    this.stepExecutor = options.stepExecutor;
    this.subFlowLoader = options.subFlowLoader;

    this.stepMap = new Map();
    for (const step of this.process.steps) {
      this.stepMap.set(step.id, step);
    }

    const initialVars = new Map<string, unknown>();
    if (options.variables) {
      for (const [key, value] of Object.entries(options.variables)) {
        initialVars.set(key, value);
      }
    }

    this.state = {
      processName: this.process.name,
      currentStepId: this.process.steps[0].id,
      variables: initialVars,
      callStack: [],
      executionTrace: [],
    };
  }

  getState(): EngineState {
    return this.state;
  }

  async run(): Promise<EngineState> {
    // run() drives the generator internally using the injected stepExecutor.
    // This keeps all existing consumers (tests, action, copilot) working unchanged.
    for await (const request of this.steps()) {
      try {
        const result = await this.stepExecutor(request.step, request.prompt, new Map(request.variables));
        this.receiveResult(request, {
          rawOutput: result.extractedData,
          response: result,
        });
      } catch (error) {
        // Feed error back so the generator can do error routing
        this.receiveResult(request, {
          rawOutput: error instanceof Error ? error.message : String(error),
          response: { status: '_error', extractedData: error instanceof Error ? error.message : String(error) },
          error,
        });
      }
    }

    // Execute post-process if present
    if (this.process.postProcess) {
      await this.executePostProcess();
    }

    return this.state;
  }

  /**
   * Async generator that yields each step to the caller before execution.
   * The surface is responsible for delegating to agents and calling receiveResult().
   *
   * Usage:
   *   for await (const request of engine.steps()) {
   *     // delegate to agent (shows in chat, CLI, cloud — each surface's native UX)
   *     const rawOutput = await myAgent.run(request.prompt);
   *     const response = await outputAdapter(rawOutput, ...);
   *     engine.receiveResult(request, { rawOutput, response });
   *   }
   */
  async *steps(): AsyncGenerator<StepRequest, void, void> {
    while (true) {
      const step = this.stepMap.get(this.state.currentStepId);
      if (!step) break;

      if (step.type === 'subflow') {
        // Subflows yield their child steps to the surface — not handled internally.
        // This lets the surface see every agent invocation, including nested ones.
        try {
          yield* this.yieldSubFlow(step);
        } catch (error) {
          this.recordError(step, error, 0);
          const errorNextId = this.evaluateErrorRouting(step);
          if (!errorNextId) break;
          this.state.currentStepId = errorNextId;
        }
        continue;
      }

      if (step.loop) {
        // Loops yield individual iterations
        yield* this.yieldLoop(step);
        continue;
      }

      // Regular step — yield to the surface
      this.events.emit('step:start', { stepId: step.id, agent: step.agent ?? 'unknown' });

      const prompt = step.input ? interpolate(step.input.text, this.state.variables) : '';

      const request: StepRequest = {
        step,
        prompt,
        variables: new Map(this.state.variables),
        depth: this.state.callStack.length,
      };

      yield request;

      // After yield, the caller must have called receiveResult().
      // The _pendingResult is consumed to determine routing.
      if (!this._pendingResult) {
        // If no result was provided (caller broke out of loop), stop.
        break;
      }

      const { response, error: resultError, startTime: resultStartTime } = this._pendingResult;
      this._pendingResult = null;

      const latencyMs = Date.now() - resultStartTime;

      if (resultError) {
        // Step threw an error — use error routing
        this.recordError(step, resultError, latencyMs);
        const errorNextId = this.evaluateErrorRouting(step);
        if (!errorNextId) break;
        this.state.currentStepId = errorNextId;
      } else {
        this.recordSuccess(step, response, latencyMs);
        const nextStepId = this.evaluateRouting(step, response.status);
        if (!nextStepId) break;
        this.state.currentStepId = nextStepId;
      }
    }
  }

  /**
   * Feed the result of an agent execution back into the engine.
   * Must be called exactly once per yielded StepRequest, before resuming the generator.
   */
  receiveResult(request: StepRequest, result: StepResult): void {
    this._pendingResult = {
      response: result.response,
      error: result.error,
      startTime: Date.now(),
    };
  }

  private _pendingResult: { response: AdapterResponse; error?: unknown; startTime: number } | null = null;

  private recordSuccess(step: Step, result: AdapterResponse, latencyMs: number): void {
    const traceEntry: TraceEntry = {
      stepId: step.id,
      agent: step.agent ?? 'subflow',
      status: result.status as TraceEntry['status'],
      latencyMs,
      tokensUsed: 0,
      rawOutput: result.extractedData,
    };
    this.state.executionTrace.push(traceEntry);

    if (step.output) {
      this.state.variables.set(step.output.saveAs, result.extractedData);
    }

    this.events.emit('step:complete', {
      stepId: step.id,
      status: result.status,
      latencyMs,
    });
  }

  private recordError(step: Step, error: unknown, latencyMs: number): void {
    const traceEntry: TraceEntry = {
      stepId: step.id,
      agent: step.agent ?? 'subflow',
      status: 'fail',
      latencyMs,
      tokensUsed: 0,
      rawOutput: error instanceof Error ? error.message : String(error),
    };
    this.state.executionTrace.push(traceEntry);
    this.events.emit('step:error', { stepId: step.id, error });
  }

  private async *yieldLoop(step: Step): AsyncGenerator<StepRequest, void, void> {
    const loop = step.loop!;
    const sourceData = this.state.variables.get(loop.source);

    if (!Array.isArray(sourceData)) {
      throw new Error(`Loop source "${loop.source}" is not an array`);
    }

    // For the generator mode, we yield each loop iteration as a separate StepRequest.
    // The run() method drives this via stepExecutor; surfaces can drive it via agent delegation.
    const results: AdapterResponse[] = [];

    // Sequential loops yield one at a time
    for (const item of sourceData) {
      const loopVars = new Map(this.state.variables);
      loopVars.set(loop.as, item);
      const prompt = step.input ? interpolate(step.input.text, loopVars) : '';

      this.events.emit('step:start', { stepId: step.id, agent: step.agent ?? 'unknown' });

      const request: StepRequest = {
        step,
        prompt,
        variables: loopVars,
        depth: this.state.callStack.length,
      };

      yield request;

      if (!this._pendingResult) break;
      const { response } = this._pendingResult;
      this._pendingResult = null;
      results.push(response);
    }

    // Aggregate loop results
    const allSuccess = results.every((r) => r.status === 'success' || r.status === 'approve');
    const aggregatedData = JSON.stringify(
      results.map((r) => ({ status: r.status, data: r.extractedData }))
    );

    const aggregatedResult: AdapterResponse = {
      status: allSuccess ? 'success' : 'fail',
      extractedData: aggregatedData,
    };

    this.recordSuccess(step, aggregatedResult, 0);

    const nextStepId = this.evaluateRouting(step, aggregatedResult.status);
    if (nextStepId) {
      this.state.currentStepId = nextStepId;
    }
  }

  private async executeLoop(step: Step): Promise<AdapterResponse> {
    const loop = step.loop!;
    const sourceData = this.state.variables.get(loop.source);

    if (!Array.isArray(sourceData)) {
      throw new Error(`Loop source "${loop.source}" is not an array`);
    }

    const results: AdapterResponse[] = [];

    if (loop.mode === 'parallel') {
      const promises = sourceData.map(async (item) => {
        const loopVars = new Map(this.state.variables);
        loopVars.set(loop.as, item);
        const prompt = step.input ? interpolate(step.input.text, loopVars) : '';
        return this.stepExecutor(step, prompt, loopVars);
      });
      const settled = await Promise.allSettled(promises);
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            status: 'fail',
            extractedData:
              result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      }
    } else {
      // Sequential
      for (const item of sourceData) {
        const loopVars = new Map(this.state.variables);
        loopVars.set(loop.as, item);
        const prompt = step.input ? interpolate(step.input.text, loopVars) : '';
        const result = await this.stepExecutor(step, prompt, loopVars);
        results.push(result);
      }
    }

    // Aggregate results
    const allSuccess = results.every((r) => r.status === 'success' || r.status === 'approve');
    const aggregatedData = JSON.stringify(
      results.map((r) => ({
        status: r.status,
        data: r.extractedData,
      }))
    );

    return {
      status: allSuccess ? 'success' : 'fail',
      extractedData: aggregatedData,
    };
  }

  private async *yieldSubFlow(step: Step): AsyncGenerator<StepRequest, void, void> {
    if (!step.src) {
      throw new Error(`Subflow step "${step.id}" has no src attribute`);
    }
    if (!this.subFlowLoader) {
      throw new Error('No subFlowLoader provided for subflow execution');
    }

    this.events.emit('step:start', { stepId: step.id, agent: step.agent ?? 'subflow' });

    const childProcess = await this.subFlowLoader(step.src);

    // Map parent variables into child
    const childVars: Record<string, unknown> = {};
    if (step.input?.mapTo) {
      const inputValue = step.input.text ? interpolate(step.input.text, this.state.variables) : '';
      childVars[step.input.mapTo] = inputValue;
    }
    for (const [key, value] of this.state.variables) {
      if (!(key in childVars)) {
        childVars[key] = value;
      }
    }

    // Push call stack
    this.state.callStack.push({
      parentProcessName: this.state.processName,
      returnStepId: step.id,
      variableContext: new Map(this.state.variables),
    });

    // Create child engine — it will use the same stepExecutor for run() compatibility,
    // but in generator mode we yield its steps directly.
    const childEngine = new Engine({
      process: childProcess,
      variables: childVars,
      stepExecutor: this.stepExecutor,
      subFlowLoader: this.subFlowLoader,
    });

    // Forward events from child
    childEngine.events.on('step:start', (data) => this.events.emit('step:start', data));
    childEngine.events.on('step:complete', (data) => this.events.emit('step:complete', data));
    childEngine.events.on('step:error', (data) => this.events.emit('step:error', data));
    childEngine.events.on('route:decision', (data) => this.events.emit('route:decision', data));

    // Yield all child steps through to the surface
    for await (const childRequest of childEngine.steps()) {
      // Re-yield with correct depth (child's depth + our current depth)
      yield childRequest;

      // The caller called receiveResult on our engine — forward it to the child
      if (this._pendingResult) {
        childEngine.receiveResult(childRequest, {
          rawOutput: this._pendingResult.response.extractedData,
          response: this._pendingResult.response,
          error: this._pendingResult.error,
        });
        this._pendingResult = null;
      }
    }

    // Pop call stack
    this.state.callStack.pop();

    // Collect child's final state
    const childState = childEngine.getState();

    // Store child trace as sub-trace on the parent step
    const childFinalTrace = childState.executionTrace[childState.executionTrace.length - 1];
    const finalStatus = childFinalTrace?.status ?? 'success';
    const finalData = childFinalTrace?.rawOutput ?? '';

    const subFlowResult: AdapterResponse = {
      status: finalStatus,
      extractedData: finalData,
    };

    // Record the subflow step itself in the parent trace (with child sub-trace)
    const traceEntry: TraceEntry = {
      stepId: step.id,
      agent: step.agent ?? 'subflow',
      status: finalStatus as TraceEntry['status'],
      latencyMs: 0,
      tokensUsed: 0,
      rawOutput: finalData,
      subTrace: childState.executionTrace,
    };
    this.state.executionTrace.push(traceEntry);

    if (step.output) {
      this.state.variables.set(step.output.saveAs, finalData);
    }

    // Route parent based on subflow result
    const nextStepId = this.evaluateRouting(step, subFlowResult.status);
    if (nextStepId) {
      this.state.currentStepId = nextStepId;
    }
  }

  private async executeSubFlow(step: Step): Promise<AdapterResponse> {
    if (!step.src) {
      throw new Error(`Subflow step "${step.id}" has no src attribute`);
    }
    if (!this.subFlowLoader) {
      throw new Error('No subFlowLoader provided for subflow execution');
    }

    // Load child process
    const childProcess = await this.subFlowLoader(step.src);

    // Map parent variables into child globals
    const childVars: Record<string, unknown> = {};
    if (step.input?.mapTo) {
      const inputValue = step.input.text ? interpolate(step.input.text, this.state.variables) : '';
      childVars[step.input.mapTo] = inputValue;
    }
    // Also pass through all parent variables
    for (const [key, value] of this.state.variables) {
      if (!(key in childVars)) {
        childVars[key] = value;
      }
    }

    // Push current state to call stack
    this.state.callStack.push({
      parentProcessName: this.state.processName,
      returnStepId: step.id,
      variableContext: new Map(this.state.variables),
    });

    // Execute child flow
    const childEngine = new Engine({
      process: childProcess,
      variables: childVars,
      stepExecutor: this.stepExecutor,
      subFlowLoader: this.subFlowLoader,
    });

    // Forward events from child
    childEngine.events.on('step:start', (data) => this.events.emit('step:start', data));
    childEngine.events.on('step:complete', (data) => this.events.emit('step:complete', data));
    childEngine.events.on('step:error', (data) => this.events.emit('step:error', data));
    childEngine.events.on('route:decision', (data) => this.events.emit('route:decision', data));

    const childState = await childEngine.run();

    // Pop call stack
    this.state.callStack.pop();

    // Store child trace as sub-trace
    const lastTrace = this.state.executionTrace[this.state.executionTrace.length - 1];
    if (lastTrace) {
      lastTrace.subTrace = childState.executionTrace;
    }

    // Get child's final status
    const childFinalTrace = childState.executionTrace[childState.executionTrace.length - 1];
    const finalStatus = childFinalTrace?.status ?? 'success';
    const finalData = childFinalTrace?.rawOutput ?? '';

    return {
      status: finalStatus,
      extractedData: finalData,
    };
  }

  private async executePostProcess(): Promise<void> {
    if (!this.process.postProcess) return;

    for (const evaluation of this.process.postProcess.evaluations) {
      const startTime = Date.now();

      this.events.emit('step:start', {
        stepId: `post-process:${evaluation.agent}`,
        agent: evaluation.agent,
      });

      try {
        // Build evaluation prompt with full execution trace
        const traceJson = JSON.stringify(this.state.executionTrace, null, 2);
        const evalPrompt = `Evaluate the following execution trace using prompt: ${evaluation.prompt}\n\nTrace:\n${traceJson}`;

        const evalStep: Step = {
          id: `post-process:${evaluation.agent}`,
          agent: evaluation.agent,
          input: { text: evalPrompt },
          output: { saveAs: `_eval_${evaluation.agent}` },
        };

        const result = await this.stepExecutor(evalStep, evalPrompt, this.state.variables);
        const latencyMs = Date.now() - startTime;

        this.state.variables.set(`_eval_${evaluation.agent}`, result.extractedData);

        this.state.executionTrace.push({
          stepId: evalStep.id,
          agent: evaluation.agent,
          status: result.status as TraceEntry['status'],
          latencyMs,
          tokensUsed: 0,
          rawOutput: result.extractedData,
        });

        this.events.emit('step:complete', {
          stepId: evalStep.id,
          status: result.status,
          latencyMs,
        });
      } catch (error) {
        const latencyMs = Date.now() - startTime;
        this.state.executionTrace.push({
          stepId: `post-process:${evaluation.agent}`,
          agent: evaluation.agent,
          status: 'fail',
          latencyMs,
          tokensUsed: 0,
          rawOutput: error instanceof Error ? error.message : String(error),
        });
        this.events.emit('step:error', {
          stepId: `post-process:${evaluation.agent}`,
          error,
        });
      }
    }
  }

  private async executeStep(step: Step): Promise<AdapterResponse> {
    // Resolve input prompt with variable interpolation
    let prompt = '';
    if (step.input) {
      prompt = interpolate(step.input.text, this.state.variables);
    }

    return this.stepExecutor(step, prompt, this.state.variables);
  }

  private evaluateRouting(step: Step, status: string): string | undefined {
    if (!step.routing) {
      return undefined;
    }

    // Evaluate on-status rules top-to-bottom
    for (const rule of step.routing.onStatus) {
      if (rule.value === status) {
        // If pass_feedback is set, inject previous output into next step's context
        if (rule.passFeedback && step.output) {
          const feedback = this.state.variables.get(step.output.saveAs);
          if (feedback !== undefined) {
            this.state.variables.set('_feedback', feedback);
          }
        }

        // Reset retry count on successful routing
        this.retryCounts.delete(step.id);

        this.events.emit('route:decision', {
          stepId: step.id,
          status,
          goto: rule.goto,
        });

        return rule.goto;
      }
    }

    // No matching on-status — check if we should retry via on-status path
    // If status doesn't match any route and there's an on-error, treat as error
    return undefined;
  }

  private evaluateErrorRouting(step: Step): string | undefined {
    if (!step.routing?.onError) {
      return undefined;
    }

    const retryKey = step.id;
    const currentRetries = this.retryCounts.get(retryKey) ?? 0;

    if (currentRetries < step.routing.onError.retryCount) {
      // Retry: go back to the same step (or the on-error goto)
      this.retryCounts.set(retryKey, currentRetries + 1);

      this.events.emit('route:decision', {
        stepId: step.id,
        status: 'error-retry',
        goto: step.routing.onError.goto,
      });

      return step.routing.onError.goto;
    }

    // Max retries exhausted — escalate
    this.retryCounts.delete(retryKey);

    if (step.routing.onMaxRetries) {
      this.events.emit('route:decision', {
        stepId: step.id,
        status: 'max-retries-escalation',
        goto: step.routing.onMaxRetries.goto,
      });

      return step.routing.onMaxRetries.goto;
    }

    return undefined;
  }
}
