import type { Step, AdapterResponse } from './types.js';
import type { AgentConfig } from './agent-config.js';
import { AdapterResponseSchema } from './schemas.js';
import { interpolate } from './variables.js';

/**
 * LLM Client interface — abstracts the actual LLM provider.
 * Implementations can use OpenAI, Anthropic, Copilot SDK, etc.
 */
export interface LLMClient {
  call(options: LLMCallOptions): Promise<string>;
}

export interface LLMCallOptions {
  model: string;
  temperature: number;
  systemPrompt: string;
  userPrompt: string;
  tools?: string[];
}

/**
 * Input Adapter: takes engine variables + step config → produces a formatted prompt for the Worker.
 */
export function inputAdapter(step: Step, variables: Map<string, unknown>): string {
  if (!step.input) return '';
  return interpolate(step.input.text, variables);
}

/**
 * Output Adapter: takes raw Worker output → calls a fast LLM to extract JSON → validates with Zod.
 * Retries up to maxRetries times on validation failure.
 */
export async function outputAdapter(
  rawOutput: string,
  llmClient: LLMClient,
  adapterConfig: AgentConfig,
  maxRetries: number = 3
): Promise<AdapterResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const extractionPrompt = buildExtractionPrompt(rawOutput);
      const response = await llmClient.call({
        model: adapterConfig.model,
        temperature: adapterConfig.temperature,
        systemPrompt: adapterConfig.systemPrompt,
        userPrompt: extractionPrompt,
      });

      const parsed = JSON.parse(response);
      return AdapterResponseSchema.parse(parsed);
    } catch (error) {
      lastError = error;
    }
  }

  // All retries exhausted — return error status for on-error routing
  return {
    status: 'error',
    extractedData: `Output adapter failed after ${maxRetries} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  };
}

function buildExtractionPrompt(rawOutput: string): string {
  return `Extract the status and key data from the following agent output. Return ONLY valid JSON matching this schema: { "status": string, "extractedData": string }

Agent output:
---
${rawOutput}
---`;
}

/**
 * Creates a full step executor pipeline: Input Adapter → Worker → Output Adapter.
 * This is the "Adapter Pattern Sandwich" from the architecture.
 */
export function createAdapterExecutor(
  llmClient: LLMClient,
  workerConfigs: Map<string, AgentConfig>,
  adapterConfig: AgentConfig,
  maxRetries: number = 3
): (step: Step, prompt: string, variables: Map<string, unknown>) => Promise<AdapterResponse> {
  return async (step, prompt, _variables) => {
    // Get worker config
    const workerConfig = workerConfigs.get(step.agent ?? '');
    if (!workerConfig) {
      throw new Error(`No agent config found for "${step.agent}"`);
    }

    // Execute Worker
    const rawOutput = await llmClient.call({
      model: workerConfig.model,
      temperature: workerConfig.temperature,
      systemPrompt: workerConfig.systemPrompt,
      userPrompt: prompt,
      tools: workerConfig.tools,
    });

    // Output Adapter: extract structured response
    return outputAdapter(rawOutput, llmClient, adapterConfig, maxRetries);
  };
}
