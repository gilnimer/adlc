/**
 * Engine Event Emitter for observability.
 * Emits events: step:start, step:complete, step:error, route:decision
 */

export interface EngineEvents {
  'step:start': { stepId: string; agent: string };
  'step:complete': { stepId: string; status: string; latencyMs: number };
  'step:error': { stepId: string; error: unknown };
  'route:decision': { stepId: string; status: string; goto: string };
}

type EventHandler<T> = (data: T) => void;

export class EngineEventEmitter {
  private handlers: Map<string, EventHandler<unknown>[]> = new Map();

  on<K extends keyof EngineEvents>(event: K, handler: EventHandler<EngineEvents[K]>): void {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler as EventHandler<unknown>);
    this.handlers.set(event, existing);
  }

  off<K extends keyof EngineEvents>(event: K, handler: EventHandler<EngineEvents[K]>): void {
    const existing = this.handlers.get(event) ?? [];
    this.handlers.set(
      event,
      existing.filter((h) => h !== handler)
    );
  }

  emit<K extends keyof EngineEvents>(event: K, data: EngineEvents[K]): void {
    const handlers = this.handlers.get(event) ?? [];
    for (const handler of handlers) {
      handler(data);
    }
  }
}
