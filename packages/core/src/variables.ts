/**
 * Variable interpolation for AOML templates.
 * Resolves ${{variable_name}} tokens from a provided variable map.
 */

export class VariableResolutionError extends Error {
  constructor(public variableName: string) {
    super(`Unresolved variable: $\{{${variableName}}}`);
    this.name = 'VariableResolutionError';
  }
}

const VARIABLE_PATTERN = /\$\{\{(\w+)\}\}/g;

/**
 * Resolve all ${{variable_name}} references in a template string.
 * Throws VariableResolutionError if a variable is not found in the map.
 */
export function interpolate(template: string, variables: Map<string, unknown>): string {
  return template.replace(VARIABLE_PATTERN, (match, name: string) => {
    if (!variables.has(name)) {
      throw new VariableResolutionError(name);
    }
    const value = variables.get(name);
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  });
}

/**
 * Extract all variable names referenced in a template string.
 */
export function extractVariableNames(template: string): string[] {
  const names: string[] = [];
  let match: RegExpExecArray | null;
  const pattern = new RegExp(VARIABLE_PATTERN.source, 'g');
  while ((match = pattern.exec(template)) !== null) {
    names.push(match[1]);
  }
  return [...new Set(names)];
}
