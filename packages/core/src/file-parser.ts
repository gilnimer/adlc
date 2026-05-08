import { readFileSync } from 'node:fs';
import { parseAoml } from './parser.js';
import type { Process } from './types.js';

/**
 * Parse an AOML file from disk and return the validated AST.
 */
export function parseAomlFile(filePath: string): Process {
  const xml = readFileSync(filePath, 'utf-8');
  return parseAoml(xml);
}
