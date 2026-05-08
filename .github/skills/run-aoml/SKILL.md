---
name: run-aoml
description: Run an AOML workflow from the repository
---

# Run AOML Workflow

Triggers the AOML Orchestration Engine to execute a workflow defined in XML.

## Usage

```
@aoml run <workflow-name>
@aoml run feature-dev --ticket PROJ-123
@aoml run qa --dry-run
```

## Parameters

- `workflow`: The workflow file to execute (resolved from `.github/workflows/`)
- `--ticket <id>`: Set the ticket_id global variable
- `--dry-run`: Validate without executing
