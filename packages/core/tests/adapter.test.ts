import { describe, it, expect, vi } from 'vitest';
import {
  inputAdapter,
  outputAdapter,
  createAdapterExecutor,
  type LLMClient,
} from '../src/adapter.js';
import type { Step } from '../src/types.js';
import type { AgentConfig } from '../src/agent-config.js';

describe('Input Adapter', () => {
  it('interpolates variables into step input', () => {
    const step: Step = {
      id: 'test',
      agent: 'dev',
      input: { text: 'Fix bug in ${{file_path}} for ticket ${{ticket_id}}' },
      output: { saveAs: 'result' },
    };
    const vars = new Map<string, unknown>([
      ['file_path', 'src/auth.ts'],
      ['ticket_id', 'PROJ-42'],
    ]);

    const prompt = inputAdapter(step, vars);
    expect(prompt).toBe('Fix bug in src/auth.ts for ticket PROJ-42');
  });

  it('returns empty string when no input', () => {
    const step: Step = { id: 'test', agent: 'dev', output: { saveAs: 'r' } };
    const vars = new Map<string, unknown>();
    expect(inputAdapter(step, vars)).toBe('');
  });
});

describe('Output Adapter', () => {
  const adapterConfig: AgentConfig = {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    systemPrompt: 'Extract JSON',
  };

  it('parses valid JSON response from LLM', async () => {
    const mockClient: LLMClient = {
      call: vi.fn().mockResolvedValue('{"status":"success","extractedData":"clean code"}'),
    };

    const result = await outputAdapter('raw output', mockClient, adapterConfig);
    expect(result).toEqual({ status: 'success', extractedData: 'clean code' });
  });

  it('retries on invalid JSON then succeeds', async () => {
    const mockClient: LLMClient = {
      call: vi
        .fn()
        .mockResolvedValueOnce('not json')
        .mockResolvedValueOnce('{"status":"approve","extractedData":"looks good"}'),
    };

    const result = await outputAdapter('raw', mockClient, adapterConfig);
    expect(result).toEqual({ status: 'approve', extractedData: 'looks good' });
    expect(mockClient.call).toHaveBeenCalledTimes(2);
  });

  it('returns error status after max retries exhausted', async () => {
    const mockClient: LLMClient = {
      call: vi.fn().mockResolvedValue('always invalid'),
    };

    const result = await outputAdapter('raw', mockClient, adapterConfig, 2);
    expect(result.status).toBe('error');
    expect(result.extractedData).toContain('failed after 2 attempts');
  });
});

describe('createAdapterExecutor', () => {
  it('creates a full pipeline: worker call + output adapter', async () => {
    const mockClient: LLMClient = {
      call: vi
        .fn()
        .mockResolvedValueOnce('I wrote the auth module successfully')
        .mockResolvedValueOnce('{"status":"success","extractedData":"auth module code"}'),
    };

    const workerConfigs = new Map<string, AgentConfig>([
      ['developer', { model: 'gpt-4o', temperature: 0.7, systemPrompt: 'You are a dev' }],
    ]);
    const adapterConfig: AgentConfig = {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      systemPrompt: 'Extract JSON',
    };

    const executor = createAdapterExecutor(mockClient, workerConfigs, adapterConfig);

    const step: Step = {
      id: 'impl',
      agent: 'developer',
      input: { text: 'Build auth' },
      output: { saveAs: 'code' },
    };
    const result = await executor(step, 'Build auth', new Map());

    expect(result).toEqual({ status: 'success', extractedData: 'auth module code' });
    expect(mockClient.call).toHaveBeenCalledTimes(2);

    // First call = worker
    expect(mockClient.call).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        model: 'gpt-4o',
        systemPrompt: 'You are a dev',
        userPrompt: 'Build auth',
      })
    );

    // Second call = output adapter
    expect(mockClient.call).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        model: 'gpt-4o-mini',
      })
    );
  });

  it('throws when agent config not found', async () => {
    const mockClient: LLMClient = { call: vi.fn() };
    const executor = createAdapterExecutor(mockClient, new Map(), {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      systemPrompt: 'Extract',
    });

    const step: Step = { id: 's', agent: 'unknown', input: { text: 'x' }, output: { saveAs: 'y' } };
    await expect(executor(step, 'x', new Map())).rejects.toThrow('No agent config found');
  });
});
