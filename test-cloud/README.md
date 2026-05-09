# AOML Pipeline Test

This directory contains a smoke test for the **AOML (Agentic Orchestration Markup Language)** orchestration engine running in cloud-agent mode.

## Description

The AOML Pipeline test validates the end-to-end execution of an AOML workflow using the cloud-agent execution mode against the `gilnimer/adlc` GitHub repository. It exercises the full pipeline — from parsing the workflow definition to dispatching steps to the appropriate agents and collecting results.

## Contents

- `workflow.xml` — AOML workflow definition for the smoke test. Defines a simple pipeline with a `developer` agent step that creates a README file, followed by a `system` no-op step.
- `run.mjs` — Node.js script that invokes the AOML action locally using a `GITHUB_TOKEN` for authentication.

## Usage

```bash
# Build all packages first
pnpm -r run build

# Run the smoke test (requires a valid GitHub token)
GITHUB_TOKEN=$(gh auth token) node test-cloud/run.mjs
```

## Requirements

- Node.js >= 20
- A GitHub personal access token with repo access (set as `GITHUB_TOKEN`)
