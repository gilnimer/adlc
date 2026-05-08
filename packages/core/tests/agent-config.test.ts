import { describe, it, expect } from 'vitest';
import { parseAgentContent, AgentRegistry } from '../src/agent-config.js';

describe('Agent Config Parser', () => {
  it('parses frontmatter with all fields', () => {
    const content = `---
model: gpt-4o
temperature: 0.7
tools:
  - code_search
  - file_edit
---
You are a senior developer. Write clean, tested TypeScript code.
`;

    const config = parseAgentContent(content);
    expect(config.model).toBe('gpt-4o');
    expect(config.temperature).toBe(0.7);
    expect(config.tools).toEqual(['code_search', 'file_edit']);
    expect(config.systemPrompt).toBe(
      'You are a senior developer. Write clean, tested TypeScript code.'
    );
  });

  it('uses defaults when frontmatter is minimal', () => {
    const content = `---
model: claude-3.5-sonnet
---
You are a QA agent.
`;

    const config = parseAgentContent(content);
    expect(config.model).toBe('claude-3.5-sonnet');
    expect(config.temperature).toBe(0.1);
    expect(config.tools).toBeUndefined();
    expect(config.systemPrompt).toBe('You are a QA agent.');
  });

  it('uses all defaults with no frontmatter', () => {
    const content = 'Just a system prompt with no YAML header.';
    const config = parseAgentContent(content);
    expect(config.model).toBe('gpt-4o-mini');
    expect(config.temperature).toBe(0.1);
    expect(config.tools).toBeUndefined();
    expect(config.systemPrompt).toBe('Just a system prompt with no YAML header.');
  });

  it('handles multiline system prompts', () => {
    const content = `---
model: gpt-4o-mini
temperature: 0.2
---
You are an adapter agent.

Your job is to extract structured JSON from raw LLM output.

Always return valid JSON matching the schema.
`;

    const config = parseAgentContent(content);
    expect(config.systemPrompt).toContain('You are an adapter agent.');
    expect(config.systemPrompt).toContain('Always return valid JSON matching the schema.');
  });
});

describe('AgentRegistry', () => {
  it('registers and resolves agents directly', () => {
    const registry = new AgentRegistry('/fake/path');
    registry.register('principal', {
      model: 'gpt-4o',
      temperature: 0.5,
      systemPrompt: 'You are a principal engineer.',
    });

    const config = registry.resolve('principal');
    expect(config.model).toBe('gpt-4o');
    expect(config.systemPrompt).toBe('You are a principal engineer.');
  });

  it('throws when agent not found and no file exists', () => {
    const registry = new AgentRegistry('/nonexistent/path');
    expect(() => registry.resolve('missing-agent')).toThrow('Agent "missing-agent" not found');
  });

  it('caches resolved agents', () => {
    const registry = new AgentRegistry('/fake');
    registry.register('qa', {
      model: 'gpt-4o-mini',
      temperature: 0.1,
      systemPrompt: 'QA',
    });

    const first = registry.resolve('qa');
    const second = registry.resolve('qa');
    expect(first).toBe(second); // Same reference = cached
  });
});
