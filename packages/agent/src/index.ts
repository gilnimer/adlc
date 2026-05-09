/**
 * @aoml/agent — Cloud Agent executor for AOML orchestration.
 *
 * Provides a StepExecutor that triggers GitHub Copilot cloud agent sessions
 * via the Issues REST API. The AOML engine drives the deterministic flow;
 * each step is an "island" that runs on GitHub's cloud infrastructure.
 */

// Monolithic executor (polls until done — for simple scripts / smoke tests)
export {
  createCloudAgentExecutor,
  type CloudAgentConfig,
  type SessionInfo,
} from './cloud-agent-executor.js';

// Event-driven ops (trigger + extract — for Actions workflow chaining)
export {
  triggerCloudAgent,
  extractCloudAgentResult,
  findLinkedPR,
  type TriggerOptions,
  type TriggerResult,
  type ExtractOptions,
} from './cloud-agent-ops.js';
