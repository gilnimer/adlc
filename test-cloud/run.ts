/**
 * Local smoke-test: runs the AOML engine in cloud-agent mode
 * against the real gilnimer/adlc repo on GitHub.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx npx tsx test-cloud/run.ts
 */
import { resolve } from 'node:path';
import { runAction } from '../packages/action/src/index.js';

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('Error: GITHUB_TOKEN env var is required.');
  console.error('Create a PAT at https://github.com/settings/tokens?type=beta');
  console.error('Scopes: Issues (rw), Pull requests (rw), Contents (r)');
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
  workspacePath: resolve(import.meta.dirname, '..'),
  variables: { ticket_id: 'SMOKE-001: Create README' },
});

console.log('\n=== Execution Summary ===');
console.log(result.summary);
console.log('\n=== Status ===');
console.log(result.status);
console.log('\n=== Trace ===');
console.log(result.trace);
