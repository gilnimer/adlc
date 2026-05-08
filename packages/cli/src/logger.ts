import type { TraceEntry } from '@aoml/core';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
};

export function formatEvent(
  type: 'start' | 'complete' | 'error' | 'route',
  data: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString().slice(11, 23);

  switch (type) {
    case 'start':
      return `${COLORS.dim}${timestamp}${COLORS.reset} ${COLORS.cyan}▶${COLORS.reset} [${data.stepId}] → ${data.agent}`;
    case 'complete': {
      const statusColor =
        data.status === 'success' || data.status === 'approve' ? COLORS.green : COLORS.yellow;
      return `${COLORS.dim}${timestamp}${COLORS.reset} ${statusColor}✓${COLORS.reset} [${data.stepId}] → ${data.status} ${COLORS.dim}(${data.latencyMs}ms)${COLORS.reset}`;
    }
    case 'error':
      return `${COLORS.dim}${timestamp}${COLORS.reset} ${COLORS.red}✗${COLORS.reset} [${data.stepId}] → error`;
    case 'route':
      return `${COLORS.dim}${timestamp}${COLORS.reset} ${COLORS.magenta}↳${COLORS.reset} ${data.stepId} → ${data.goto} ${COLORS.dim}(${data.status})${COLORS.reset}`;
  }
}

export function formatTrace(trace: TraceEntry[]): string {
  const lines: string[] = ['\n─── Execution Summary ───'];

  for (const entry of trace) {
    const statusIcon =
      entry.status === 'success' || entry.status === 'approve'
        ? `${COLORS.green}✓${COLORS.reset}`
        : entry.status === 'fail'
          ? `${COLORS.red}✗${COLORS.reset}`
          : `${COLORS.yellow}●${COLORS.reset}`;

    lines.push(
      `  ${statusIcon} [${entry.stepId}] ${entry.agent} → ${entry.status} ${COLORS.dim}(${entry.latencyMs}ms)${COLORS.reset}`
    );

    if (entry.subTrace && entry.subTrace.length > 0) {
      for (const sub of entry.subTrace) {
        lines.push(
          `    └─ [${sub.stepId}] ${sub.agent} → ${sub.status} ${COLORS.dim}(${sub.latencyMs}ms)${COLORS.reset}`
        );
      }
    }
  }

  lines.push('─────────────────────────\n');
  return lines.join('\n');
}
