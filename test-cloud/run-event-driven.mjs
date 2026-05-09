/**
 * Local smoke-test for event-driven mode.
 *
 * Phase 1 — startStep:
 *   GITHUB_TOKEN=$(gh auth token) node test-cloud/run-event-driven.mjs start
 *
 * Phase 2 — continueStep (after agent finishes and creates a PR):
 *   GITHUB_TOKEN=$(gh auth token) node test-cloud/run-event-driven.mjs continue <pr-number>
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStep, continueStep } from '../packages/action/dist/index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

const owner = 'gilnimer';
const repo = 'adlc';

async function main() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Error: GITHUB_TOKEN env var is required.');
    console.error('Use: GITHUB_TOKEN=$(gh auth token) node test-cloud/run-event-driven.mjs start');
    process.exit(1);
  }

  const mode = process.argv[2] ?? 'start';

  if (mode === 'start') {
    console.log('\n=== AOML Event-Driven: startStep ===');
    console.log(`Repo:     ${owner}/${repo}`);
    console.log(`Workflow: test-cloud/workflow.xml\n`);

    const result = await startStep({
      workflowFile: 'test-cloud/workflow.xml',
      variables: { ticket_id: 'EVENT-DRIVEN-001: Create README' },
      githubToken: token,
      workspacePath: root,
      owner,
      repoName: repo,
    });

    console.log('\n=== Result ===');
    console.log(`Done:    ${result.done}`);
    console.log(`Step:    ${result.stepId}`);
    console.log(`Issue:   #${result.issueNumber}`);

    if (!result.done) {
      console.log(`\nWait for the agent to create a PR, then run:`);
      console.log(
        `  GITHUB_TOKEN=$(gh auth token) node test-cloud/run-event-driven.mjs continue <pr-number>`
      );
    }
  } else if (mode === 'continue') {
    const prNumber = parseInt(process.argv[3], 10);
    if (!prNumber) {
      console.error('Usage: node test-cloud/run-event-driven.mjs continue <pr-number>');
      process.exit(1);
    }

    console.log(`\n=== AOML Event-Driven: continueStep (PR #${prNumber}) ===\n`);

    const result = await continueStep({
      workflowFile: 'test-cloud/workflow.xml', // ignored — loaded from checkpoint
      variables: {}, // ignored — loaded from checkpoint
      githubToken: token,
      workspacePath: root,
      owner,
      repoName: repo,
      prNumber,
    });

    console.log('\n=== Result ===');
    console.log(`Done:    ${result.done}`);
    console.log(`Step:    ${result.stepId}`);
    console.log(`Issue:   #${result.issueNumber}`);
    if (result.summary) {
      console.log(`\n${result.summary}`);
    }

    if (!result.done) {
      console.log(`\nWait for the agent to create a PR, then run:`);
      console.log(
        `  GITHUB_TOKEN=$(gh auth token) node test-cloud/run-event-driven.mjs continue <pr-number>`
      );
    }
  } else {
    console.error(`Unknown mode: ${mode}. Use "start" or "continue".`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
