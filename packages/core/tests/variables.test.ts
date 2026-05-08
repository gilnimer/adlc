import { describe, it, expect } from 'vitest';
import { interpolate, extractVariableNames, VariableResolutionError } from '../src/variables.js';

describe('Variable Interpolation', () => {
  it('resolves string variables', () => {
    const vars = new Map<string, unknown>([['name', 'Alice']]);
    expect(interpolate('Hello ${{name}}!', vars)).toBe('Hello Alice!');
  });

  it('resolves multiple variables', () => {
    const vars = new Map<string, unknown>([
      ['ticket_id', 'PROJ-123'],
      ['branch', 'feature/auth'],
    ]);
    const result = interpolate('Working on ${{ticket_id}} in ${{branch}}', vars);
    expect(result).toBe('Working on PROJ-123 in feature/auth');
  });

  it('serializes non-string values as JSON', () => {
    const vars = new Map<string, unknown>([['data', { key: 'value' }]]);
    expect(interpolate('Data: ${{data}}', vars)).toBe('Data: {"key":"value"}');
  });

  it('throws VariableResolutionError on missing variable', () => {
    const vars = new Map<string, unknown>();
    expect(() => interpolate('${{missing}}', vars)).toThrow(VariableResolutionError);
  });

  it('returns template unchanged if no variables', () => {
    const vars = new Map<string, unknown>();
    expect(interpolate('No variables here', vars)).toBe('No variables here');
  });
});

describe('extractVariableNames', () => {
  it('extracts unique variable names from template', () => {
    const names = extractVariableNames('${{a}} and ${{b}} and ${{a}}');
    expect(names).toEqual(['a', 'b']);
  });

  it('returns empty array for no variables', () => {
    expect(extractVariableNames('plain text')).toEqual([]);
  });
});
