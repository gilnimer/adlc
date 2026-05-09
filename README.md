# AOML — Agentic Orchestration Markup Language

AOML is an orchestration engine that lets you define multi-step, multi-agent workflows in a simple XML format and execute them with cloud-hosted AI coding agents (such as GitHub Copilot).

## Overview

This repository contains the AOML Pipeline test project. It serves as a smoke test and reference implementation for the AOML orchestration engine, demonstrating how to:

- Define workflows as XML pipelines (`workflow.xml`)
- Assign individual steps to specific AI agents (e.g. `developer`, `system`)
- Pass variables between steps
- Run the engine in **cloud-agent** mode against a real GitHub repository

## Repository Structure

```
packages/
  action/   – GitHub Action entry-point that runs AOML workflows
  agent/    – Agent interfaces and adapters
  cli/      – Command-line interface
  copilot/  – GitHub Copilot cloud-agent integration
  core/     – Core engine: parser, executor, and step router
test-cloud/
  workflow.xml  – Sample cloud-agent smoke-test workflow
  run.mjs       – Local runner script for the smoke test
```

## Getting Started

### Prerequisites

- Node.js ≥ 20
- [pnpm](https://pnpm.io/) 9.x

### Install & Build

```bash
pnpm install
pnpm run build
```

### Run the Smoke Test

```bash
GITHUB_TOKEN=$(gh auth token) node test-cloud/run.mjs
```

This executes the workflow defined in `test-cloud/workflow.xml` against the `gilnimer/adlc` repository using the GitHub Copilot cloud agent.

## License

MIT
