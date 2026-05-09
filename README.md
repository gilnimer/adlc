# AOML Pipeline Test Project

**AOML** (Agentic Orchestration Markup Language) is an orchestration engine that coordinates AI agents through declarative XML-based workflow definitions.

## Description

This project is a smoke test for the AOML orchestration engine. It demonstrates how to define and execute multi-step agentic pipelines where each step is handled by a specialized AI agent. Workflows are described in XML, making them easy to read, version, and extend.

## Features

- Declarative XML workflow definitions
- Multi-agent orchestration with step-level routing
- Support for global variables and step outputs
- Manual and event-based triggers

## Getting Started

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test
```

## Running a Workflow

Example workflows are located in the `test-cloud/` directory. To run a workflow:

```bash
node test-cloud/run.mjs
```

## Project Structure

```
├── packages/          # Core library packages
│   ├── action/        # Action primitives
│   ├── agent/         # Agent implementations
│   ├── cli/           # Command-line interface
│   ├── copilot/       # Copilot integration
│   └── core/          # Core orchestration engine
├── test-cloud/        # Smoke test workflows
└── docs/              # Documentation
```

## License

See [LICENSE](LICENSE) for details.
