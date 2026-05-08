import { describe, it, expect } from 'vitest';
import { ProcessSchema, AdapterResponseSchema } from '../src/schemas.js';

describe('Zod Schemas', () => {
  it('validates a correct process', () => {
    const valid = {
      name: 'test',
      type: 'workflow',
      steps: [
        {
          id: 'step1',
          agent: 'principal',
          input: { text: 'hello' },
          output: { saveAs: 'result' },
        },
      ],
    };
    expect(() => ProcessSchema.parse(valid)).not.toThrow();
  });

  it('rejects a process with empty name', () => {
    const invalid = {
      name: '',
      type: 'workflow',
      steps: [{ id: 'a', agent: 'x', input: { text: 'y' }, output: { saveAs: 'z' } }],
    };
    expect(() => ProcessSchema.parse(invalid)).toThrow();
  });

  it('rejects subflow step without src', () => {
    const invalid = {
      name: 'test',
      type: 'workflow',
      steps: [{ id: 'sub', type: 'subflow', input: { text: 'x' }, output: { saveAs: 'y' } }],
    };
    expect(() => ProcessSchema.parse(invalid)).toThrow();
  });

  it('validates adapter response', () => {
    const valid = { status: 'approve', extractedData: 'clean code here' };
    expect(AdapterResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects adapter response missing status', () => {
    expect(() => AdapterResponseSchema.parse({ extractedData: 'x' })).toThrow();
  });
});
