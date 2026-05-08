import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import matter from 'gray-matter';

/**
 * Agent configuration extracted from .md files with YAML frontmatter.
 */
export interface AgentConfig {
  model: string;
  temperature: number;
  tools?: string[];
  systemPrompt: string;
}

/**
 * Parse an agent .md file and extract its configuration.
 * YAML frontmatter defines model/temperature/tools; the body is the system prompt.
 */
export function parseAgentFile(filePath: string): AgentConfig {
  const content = readFileSync(filePath, 'utf-8');
  return parseAgentContent(content);
}

/**
 * Parse agent markdown content (for testing without filesystem).
 */
export function parseAgentContent(content: string): AgentConfig {
  const { data, content: body } = matter(content);

  return {
    model: typeof data.model === 'string' ? data.model : 'gpt-4o-mini',
    temperature: typeof data.temperature === 'number' ? data.temperature : 0.1,
    tools: Array.isArray(data.tools) ? data.tools : undefined,
    systemPrompt: body.trim(),
  };
}

/**
 * Agent registry that resolves agent names to their configurations.
 */
export class AgentRegistry {
  private configs: Map<string, AgentConfig> = new Map();
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  /**
   * Resolve an agent name to its config.
   * Looks for `{basePath}/{agentName}.agent.md` or `{basePath}/{agentName}.md`.
   */
  resolve(agentName: string): AgentConfig {
    const cached = this.configs.get(agentName);
    if (cached) return cached;

    const candidates = [
      resolve(this.basePath, `${agentName}.agent.md`),
      resolve(this.basePath, `${agentName}.md`),
    ];

    for (const filePath of candidates) {
      try {
        const config = parseAgentFile(filePath);
        this.configs.set(agentName, config);
        return config;
      } catch {
        // Try next candidate
      }
    }

    throw new Error(`Agent "${agentName}" not found. Searched: ${candidates.join(', ')}`);
  }

  /**
   * Register an agent config directly (useful for testing).
   */
  register(agentName: string, config: AgentConfig): void {
    this.configs.set(agentName, config);
  }
}
