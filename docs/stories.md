# AOML Orchestration Engine — Technical Refinement & Story Breakdown

## Refinement Strategy

### Approach: Bottom-Up, Contract-First, Vertical Slices

The implementation follows a **layered foundation strategy** — build the deterministic core first, then layer on LLM integration, then platform wrappers. Each epic delivers a **vertically testable slice** of the system.

### Guiding Principles

1. **Contract-First:** Define TypeScript interfaces and Zod schemas before implementation. Every layer communicates through validated contracts.
2. **Determinism Before Intelligence:** The Engine must be fully testable with mocked adapters before any LLM calls are wired.
3. **Monorepo from Day 1:** Set up `@aoml/core`, `@aoml/cli`, `@aoml/action`, `@aoml/copilot` packages immediately — even if mostly empty — to enforce separation.
4. **Test at Every Layer:** Unit tests for the parser/router, integration tests for the adapter loop, E2E tests for CLI workflows.

### Dependency Graph

```
Epic 1: Project Scaffold
    ↓
Epic 2: AOML Parser
    ↓
Epic 3: Engine Core (State Machine)
    ↓
Epic 4: Adapter Layer ←── Epic 5: Agent Config System
    ↓
Epic 6: Routing & Control Flow
    ↓
Epic 7: Loops & Parallelism
    ↓
Epic 8: Sub-Flows & Call Stack
    ↓
Epic 9: Telemetry & Post-Process
    ↓
Epic 10: CLI Package
    ↓
Epic 11: GitHub Actions Package
    ↓
Epic 12: Copilot Extension Package
```

---

## Epic 1: Project Scaffold & Monorepo Setup

> **Goal:** Establish the monorepo structure, tooling, and CI so all future work lands in the right place.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 1.1 | **Initialize monorepo with pnpm workspaces** | `pnpm install` resolves cross-package deps. Packages: `@aoml/core`, `@aoml/cli`, `@aoml/action`, `@aoml/copilot`. |
| 1.2 | **Configure TypeScript project references** | `tsc --build` compiles all packages. Strict mode enabled. Path aliases work across packages. |
| 1.3 | **Set up Vitest for unit/integration testing** | `pnpm test` runs tests across all packages. Coverage reporting enabled. |
| 1.4 | **Add ESLint + Prettier** | Linting passes on empty packages. Consistent config shared at root. |
| 1.5 | **Create CI workflow (GitHub Actions)** | PR checks run lint, typecheck, and test. |

---

## Epic 2: AOML Parser

> **Goal:** Parse `.xml`/`.aoml` files into a typed AST that the Engine can traverse.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 2.1 | **Define AOML AST TypeScript interfaces** | Interfaces for `Process`, `Step`, `Input`, `Output`, `Routing`, `OnStatus`, `OnError`, `OnMaxRetries`, `Loop`, `PostProcess`, `Evaluate`, `Trigger`, `Globals`, `Var`. All exported from `@aoml/core`. |
| 2.2 | **Implement XML-to-AST parser using `fast-xml-parser`** | Given a valid AOML XML string, returns a typed `Process` object. Handles all tags from TSD §5.3. |
| 2.3 | **Implement Zod schema validation for parsed AST** | Invalid AOML (missing required attrs, unknown tags) throws structured validation errors with line context. |
| 2.4 | **Implement variable interpolation resolver** | `${{variable_name}}` tokens in `<input>` text are resolved from a provided variable map. Throws on unresolved required variables. |
| 2.5 | **Add file-based parser entry point** | `parseAomlFile(filePath)` reads from disk and returns validated AST. Used by CLI/Action wrappers. |

---

## Epic 3: Engine Core (State Machine)

> **Goal:** Build the deterministic execution loop that steps through the AST — with no LLM calls yet (mocked adapters).

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 3.1 | **Define `EngineState` interface with call stack** | Matches TSD §5.1. Includes `processName`, `currentStepId`, `variables` (Map), `callStack`, `executionTrace`. |
| 3.2 | **Implement `Engine` class with step execution loop** | Given an AST and initial variables, iterates through steps sequentially. Calls an injected `executeStep` handler for each step. Stops at terminal state. |
| 3.3 | **Implement variable scope management** | `<output save_as="x">` stores data. Next step's `<input>` can reference `${{x}}`. Global vs local scope rules enforced. |
| 3.4 | **Implement basic routing evaluation** | After a step returns `{ status }`, the engine evaluates `<on-status>` rules top-to-bottom and moves to the matching `goto` step ID. |
| 3.5 | **Add engine event emitter for observability** | Engine emits events: `step:start`, `step:complete`, `step:error`, `route:decision`. Consumers can subscribe for logging. |

---

## Epic 4: Adapter Layer

> **Goal:** Implement the Input/Output Adapter pattern that wraps Worker Nodes, converting between engine state and LLM I/O.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 4.1 | **Define `AdapterResponse` Zod schema** | `{ status: string, extractedData: string }` validated with Zod. Matches TSD §5.4. |
| 4.2 | **Implement Input Adapter function** | Takes engine variables + step config → produces a formatted prompt string for the Worker. |
| 4.3 | **Implement Output Adapter function** | Takes raw Worker text output → calls a fast LLM to extract JSON → validates with Zod → returns `AdapterResponse`. |
| 4.4 | **Implement retry logic for Output Adapter** | If Zod validation fails, retries up to N times (configurable). On max retries, returns error status for `<on-error>` routing. |
| 4.5 | **Integrate Adapter Layer into Engine execution loop** | Engine's `executeStep` pipeline: Input Adapter → Worker call → Output Adapter → return to Engine. Full cycle works with mocked LLM. |

---

## Epic 5: Agent Configuration System

> **Goal:** Dynamically configure LLM sessions from `.md` agent files using YAML frontmatter.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 5.1 | **Implement `gray-matter` frontmatter parser for agent files** | Given a `.md` file path, extracts `model`, `temperature`, `tools`, and system prompt body. |
| 5.2 | **Define `AgentConfig` interface** | Typed config: `{ model: string, temperature: number, tools?: string[], systemPrompt: string }`. |
| 5.3 | **Implement agent registry/resolver** | Given a step's `agent` attribute (e.g., "principal"), resolves to the correct `.md` file path and returns parsed `AgentConfig`. |
| 5.4 | **Wire agent config into Worker Node session creation** | `CopilotClient.createSession()` receives dynamically resolved model/temperature from the agent's `.md` frontmatter. |

---

## Epic 6: Routing & Error Handling

> **Goal:** Complete the routing engine with error paths and escalation.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 6.1 | **Implement `<on-error>` routing with retry_count** | If a step errors, engine retries up to `retry_count` times before routing to the `<on-error>` goto target. |
| 6.2 | **Implement `<on-max-retries>` escalation** | When retry limit is exhausted on any routing path, engine routes to the escalation step. |
| 6.3 | **Implement `pass_feedback` on `<on-status>`** | When `pass_feedback="true"`, the previous step's output is injected into the next step's input context (for revision loops). |
| 6.4 | **Validate routing graph for dead ends at parse time** | Parser warns if any `goto` references a non-existent step ID. Catches broken workflows early. |

---

## Epic 7: Loops & Parallelism

> **Goal:** Implement `<loop>` tag for sequential and parallel multi-item execution.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 7.1 | **Implement sequential `<loop>` execution** | Given `source` list variable + `as` item name, executes the wrapped step once per item, sequentially. |
| 7.2 | **Implement parallel `<loop>` execution with `Promise.all()`** | `mode="parallel"` executes all loop iterations concurrently. Aggregates results into a list variable. |
| 7.3 | **Implement Git Worktree provisioning for parallel code tasks** | For code-modifying parallel loops, create temp worktrees per iteration. Merge on completion. |
| 7.4 | **Add loop-level error handling** | If one parallel iteration fails, others continue. Aggregated results include per-item status. |

---

## Epic 8: Sub-Flows & Call Stack

> **Goal:** Enable composable workflows via `<step type="subflow">`.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 8.1 | **Implement sub-flow loading from `src` attribute** | Engine detects `type="subflow"`, loads the referenced `.xml` file, and parses it. |
| 8.2 | **Implement call stack push/pop for sub-flow execution** | Parent state is pushed to `callStack`. Child flow executes with its own scope. On completion, parent state is restored. |
| 8.3 | **Implement `<input map_to>` variable mapping into child globals** | Parent variables are mapped into child's expected global names via the `map_to` attribute. |
| 8.4 | **Implement `<output save_as>` from sub-flow final state** | Child flow's final output is saved into parent's variable scope under `save_as` name. |
| 8.5 | **Route parent based on sub-flow's terminal status** | Parent's `<routing>` evaluates against the child's final step status. |

---

## Epic 9: Telemetry & Post-Process

> **Goal:** Structured execution tracing and meta-agent evaluation.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 9.1 | **Implement execution trace recording** | Every step appends to `executionTrace`: stepId, agent, status, latencyMs, tokensUsed, rawOutput. |
| 9.2 | **Implement sub-flow trace nesting** | Sub-flow traces are stored in `subTrace` field of the parent step's trace entry. |
| 9.3 | **Implement `<post-process>` block execution** | After all `<steps>` resolve, engine executes `<post-process>` children sequentially. |
| 9.4 | **Implement `<evaluate>` tag for meta-agent grading** | Meta-agent receives full execution trace + its prompt file. Returns a grade/report stored in trace. |
| 9.5 | **Export execution trace as JSON file** | CLI and Action can write the full trace to disk/PR comment. |

---

## Epic 10: CLI Package (`@aoml/cli`)

> **Goal:** Ship a usable local CLI that runs AOML workflows end-to-end.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 10.1 | **Implement `aoml run <file> --ticket <id>` command** | Parses args, loads AOML file, injects globals, triggers engine. |
| 10.2 | **Implement real-time execution logging** | Subscribe to engine events. Print colored, structured logs: `[step:plan] → principal → success (1.2s)`. |
| 10.3 | **Implement `--dry-run` mode** | Validates AOML, resolves variables, prints execution plan without calling LLMs. |
| 10.4 | **Implement `--trace-output <path>` flag** | Writes JSON execution trace to specified file path on completion. |
| 10.5 | **Package as global npm binary** | `npm install -g @aoml/cli` registers `aoml` command. |

---

## Epic 11: GitHub Actions Package (`@aoml/action`)

> **Goal:** Run AOML workflows in CI, triggered by GitHub events.

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 11.1 | **Create GitHub Action `action.yml` definition** | Inputs: `workflow-file`, `variables` (JSON). Runs the engine via `@aoml/core`. |
| 11.2 | **Wire `@actions/core` for input/output** | Reads action inputs, maps to engine globals. Sets outputs from execution trace. |
| 11.3 | **Implement PR comment output** | On `pull_request` trigger, posts execution summary as a PR comment via `@actions/github`. |
| 11.4 | **Implement Issue update output** | On `issues` trigger, appends results to the issue body/comments. |
| 11.5 | **Handle webhook-based triggering** | Action triggers on configurable events. Maps event payload fields to AOML globals. |

---

## Epic 12: Copilot Extension Package (`@aoml/copilot`)

> **Goal:** Expose the engine as a Copilot Chat participant (`@aoml`).

| ID | Story | Acceptance Criteria |
|----|-------|-------------------|
| 12.1 | **Create `aoml-dispatcher.agent.md` with intent parsing** | Agent file with proper frontmatter. Responds to `@aoml` mentions in chat. |
| 12.2 | **Implement Dispatcher → Engine bridge** | Dispatcher parses user intent, resolves workflow file, gathers variables via conversation, then invokes the engine. |
| 12.3 | **Implement chat-based variable gathering** | If required globals are missing, Dispatcher asks the user in chat before proceeding. |
| 12.4 | **Implement execution trace → Markdown UI formatting** | Raw JSON trace is formatted into collapsible Markdown sections in the chat response. |
| 12.5 | **Register as Copilot Skill with `SKILL.md`** | Skill manifest allows triggering from other agents or chat commands. |

---

## Implementation Order & Sprint Plan

| Sprint | Epics | Deliverable |
|--------|-------|-------------|
| **1** | 1, 2 | Monorepo scaffold + AOML parser with validation |
| **2** | 3, 5 | Engine state machine + agent config (mocked LLM) |
| **3** | 4, 6 | Adapter layer + full routing (mocked LLM, full deterministic loop) |
| **4** | 7, 8 | Loops, parallelism, sub-flows |
| **5** | 9, 10 | Telemetry + CLI (first runnable E2E) |
| **6** | 11, 12 | GitHub Actions + Copilot Extension |

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| `@github/copilot-sdk` API instability | Abstract behind an `LLMClient` interface in `@aoml/core`. Swap providers without engine changes. |
| Parallel worktree merges cause conflicts | Scope parallel loops to read-only analysis tasks in V1. Defer write-parallelism to V2. |
| Output Adapter JSON extraction unreliable | Zod retry loop + structured output mode (if model supports). Escalation path via `<on-max-retries>`. |
| AOML schema grows beyond XML readability | Track complexity. If >20 tags needed, evaluate migration to YAML superset in V2. |

---

## Definition of Done (Global)

- [ ] TypeScript strict mode passes
- [ ] Unit test coverage ≥ 80% for `@aoml/core`
- [ ] Integration test with mocked LLM for each epic
- [ ] CI green (lint + typecheck + test)
- [ ] Documentation updated in repo README
