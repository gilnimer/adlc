/**
 * Local smoke-test: runs the AOML engine in cloud-agent mode
 * against the real gilnimer/adlc repo on GitHub.
 *
 * Usage:
 *   pnpm -r run build && node test-cloud/run.mjs
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAction } from '../packages/action/dist/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN env var is required.');
    console.error('Use: GITHUB_TOKEN=$(gh auth token) node test-cloud/run.mjs');
    process.exit(1);
  }

  const owner = 'gilnimer';
  const repo = 'adlc';

  console.log(`\n=== AOML Cloud Agent Smoke Test ===`);
  console.log(`Repo:     ${owner}/${repo}`);
  console.log(`Workflow: test-cloud/workflow.xml\n`);

  const result = await runAction({
    workflowFile: 'test-cloud/workflow.xml',
    githubToken: token,
    executionMode: 'cloud-agent',
    owner,
    repoName: repo,
    workspacePath: resolve(__dirname, '..'),
    variables: { ticket_id: 'SMOKE-001: Create README' },
  });

  console.log('\n=== Execution Summary ===');
  console.log(result.summary);
  console.log('\n=== Status ===');
  console.log(result.status);
  console.log('\n=== Trace ===');
  console.log(result.trace);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
