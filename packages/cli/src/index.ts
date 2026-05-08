import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
  parseAomlFile,
  Engine,
  type StepExecutor,
  type SubFlowLoader,
  type Process,
} from '@aoml/core';
import { formatEvent, formatTrace } from './logger.js';

interface CliOptions {
  file: string;
  variables: Record<string, string>;
  dryRun: boolean;
  traceOutput?: string;
}

export async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv);

  if (!options) {
    printUsage();
    return;
  }

  const aomlProcess = parseAomlFile(resolve(options.file));

  if (options.dryRun) {
    console.log(formatDryRun(aomlProcess, options.variables));
    return;
  }

  // Create a mock step executor (real LLM integration comes from adapter layer)
  const executor: StepExecutor = createMockExecutor();

  const subFlowLoader: SubFlowLoader = (src) => {
    const basePath = dirname(resolve(options.file));
    return parseAomlFile(resolve(basePath, src));
  };

  const engine = new Engine({
    process: aomlProcess,
    variables: options.variables,
    stepExecutor: executor,
    subFlowLoader,
  });

  // Subscribe to events for real-time logging
  engine.events.on('step:start', (data) => {
    console.log(formatEvent('start', data));
  });
  engine.events.on('step:complete', (data) => {
    console.log(formatEvent('complete', data));
  });
  engine.events.on('step:error', (data) => {
    console.log(formatEvent('error', data));
  });
  engine.events.on('route:decision', (data) => {
    console.log(formatEvent('route', data));
  });

  const finalState = await engine.run();

  // Output trace
  if (options.traceOutput) {
    const traceJson = JSON.stringify(finalState.executionTrace, null, 2);
    writeFileSync(resolve(options.traceOutput), traceJson, 'utf-8');
    console.log(`\nTrace written to ${options.traceOutput}`);
  }

  console.log(formatTrace(finalState.executionTrace));
}

function parseArgs(argv: string[]): CliOptions | null {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    return null;
  }

  const command = argv[0];
  if (command !== 'run') {
    console.error(`Unknown command: ${command}`);
    return null;
  }

  const file = argv[1];
  if (!file) {
    console.error('Missing workflow file path');
    return null;
  }

  const variables: Record<string, string> = {};
  let dryRun = false;
  let traceOutput: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--trace-output' && argv[i + 1]) {
      traceOutput = argv[++i];
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = argv[++i];
      if (value !== undefined) {
        variables[key] = value;
      }
    }
  }

  return { file, variables, dryRun, traceOutput };
}

function printUsage(): void {
  console.log(`
AOML Orchestration Engine CLI

Usage:
  aoml run <file> [options]

Options:
  --<variable> <value>    Set a global variable (e.g., --ticket PROJ-123)
  --dry-run               Validate and print execution plan without running
  --trace-output <path>   Write JSON execution trace to file
  --help, -h              Show this help message

Examples:
  aoml run workflows/feature-dev.xml --ticket PROJ-123
  aoml run workflows/qa.xml --dry-run
  aoml run workflows/deploy.xml --trace-output trace.json
`);
}

function formatDryRun(aomlProcess: Process, variables: Record<string, string>): string {
  const lines: string[] = [];
  lines.push(`\n[DRY RUN] Process: ${aomlProcess.name} (${aomlProcess.type})`);

  if (aomlProcess.globals) {
    lines.push('\nGlobals:');
    for (const v of aomlProcess.globals.vars) {
      const provided = v.name in variables;
      const status = provided
        ? `✓ "${variables[v.name]}"`
        : v.required
          ? '✗ MISSING'
          : '○ optional';
      lines.push(`  ${v.name}: ${status}`);
    }
  }

  lines.push('\nExecution Plan:');
  for (let i = 0; i < aomlProcess.steps.length; i++) {
    const step = aomlProcess.steps[i];
    const type = step.type === 'subflow' ? `subflow → ${step.src}` : `agent: ${step.agent}`;
    lines.push(`  ${i + 1}. [${step.id}] ${type}`);
    if (step.routing) {
      for (const r of step.routing.onStatus) {
        lines.push(`     └─ ${r.value} → ${r.goto}`);
      }
      if (step.routing.onError) {
        lines.push(
          `     └─ error → ${step.routing.onError.goto} (retry: ${step.routing.onError.retryCount})`
        );
      }
    }
  }

  if (aomlProcess.postProcess) {
    lines.push('\nPost-Process:');
    for (const e of aomlProcess.postProcess.evaluations) {
      lines.push(`  - evaluate: ${e.agent} (${e.prompt})`);
    }
  }

  return lines.join('\n');
}

function createMockExecutor(): StepExecutor {
  return async (step, prompt) => {
    return {
      status: 'success',
      extractedData: `[mock] Executed step "${step.id}" with prompt: ${prompt.slice(0, 100)}`,
    };
  };
}
