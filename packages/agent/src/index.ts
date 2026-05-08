/**
 * @aoml/agent — Cloud Agent executor for AOML orchestration.
 *
 * Provides a StepExecutor that triggers GitHub Copilot cloud agent sessions
 * via the Issues REST API. The AOML engine drives the deterministic flow;
 * each step is an "island" that runs on GitHub's cloud infrastructure.
 */
export {
  createCloudAgentExecutor,
  type CloudAgentConfig,
  type SessionInfo,
} from './cloud-agent-executor.js';
