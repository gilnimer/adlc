# **Technical Solution Design (TSD)**

**Project:** AOML Orchestration Engine (Agentic Orchestration Markup Language) **Phase:** Technical Discovery & Architecture **Target Environments:** Local CLI, VS Code Copilot Chat, GitHub Actions, GitHub Agent HQ

## **1\. System Overview**

The AOML Engine is a deterministic, multi-agent state machine. It leverages the "Foreman Pattern" to orchestrate complex AI workflows defined in XML. By decoupling the control flow (deterministic code) from the task execution (LLMs) via an "Adapter Layer", the system achieves 100% routing reliability while maintaining the flexibility of conversational AI. It uses the `@github/copilot-sdk` to manage isolated native cloud/local sessions, completely bypassing the need for third-party orchestration frameworks like Vercel AI SDK or LangChain.

## **2\. Technology Stack**

- **Runtime:** Node.js (TypeScript)
- **LLM Orchestration:** `@github/copilot-sdk` (Natively handles auth, proxying, and session creation)
- **XML Parsing:** `fast-xml-parser` (Synchronous, lightweight AOML parsing)
- **Data Validation:** `zod` (Validates both AOML syntax and LLM JSON outputs)
- **Markdown Parsing:** `gray-matter` (Extracts YAML frontmatter from `.md` Agent files to dynamically configure LLM models, tools, and temperatures)
- **Parallelization:** Native JS `Promise.all()` paired with Git Worktrees for code isolation.

## **3\. High-Level Architecture**

The system consists of four distinct functional layers, moving from the human interface down to the domain logic:

### **3.1. The Dispatcher Agent (Human-Machine Interface)**

The entry point for the user (e.g., `@aoml-dispatcher`). It acts as a concierge with four jobs:

1. **Intent Parsing:** Translates natural language ("deploy auth") into specific workflow targets (`feature-dev.xml`).
2. **Variable Gathering:** Converses with the user to collect missing required globals (e.g., Jira Ticket IDs) before starting the Engine.
3. **Execution:** Triggers the native Agent Skill (`run.sh`) to start the TypeScript Engine.
4. **Presentation:** Catches raw JSON execution traces emitted by the Engine and formats them into a readable Markdown UI in the chat window.

### **3.2. The Engine (State Machine)**

A pure TypeScript class that reads the AOML file, holds variables in memory, and acts as the traffic cop. It does no reasoning. It executes `<step>` blocks, resolves variable scopes (including recursive sub-flow execution via a call stack), and evaluates `<routing>` paths based strictly on JSON states returned by the Adapter Layer.

### **3.3. The Adapter Layer (Translators)**

Small, fast LLM functions that wrap the Worker Nodes. Their behavior and parsing instructions are defined in a native `.md` agent file (`aoml-adapter.agent.md`).

- **Dynamic Configuration:** The Engine uses `gray-matter` to parse the YAML frontmatter of the `.md` file, extracting specific Copilot SDK configuration parameters (e.g., `model: gpt-4o-mini`, `temperature: 0.1`).
- **Input Adapters:** Format variables and raw state into clean prompts for Worker Nodes.
- **Output Adapters:** Take conversational responses from Worker Nodes and force them into strict JSON schemas (`{ status: string, extractedData: string }`) for the Engine to route deterministically. Built-in `try/catch` retry loops handle parsing failures without breaking the workflow.

### **3.4. Worker Nodes (Domain Experts)**

Native isolated sessions spawned via `CopilotClient.createSession()`. These use frontier models (e.g., `gpt-4o`, `claude-3.5-sonnet`) defined dynamically via their Markdown YAML headers, and utilize predefined prompts (`.prompt.md`) to write code, review PRs, or plan architecture.

## **4\. Execution Flow Sequence**

When a workflow is triggered, the Engine performs the following cycle for each `<step>`:

1. **Parse:** Read current `<step>` from AOML. Check if it is a standard agent task or a `subflow`.
2. **Sub-Flow Handling (If applicable):** Push current state to the Call Stack, load the child `.xml` file, map inputs to child globals, and execute child workflow to completion. Return to step 4 with child's final state.
3. **Pre-Process:** Engine passes step variables to Input Adapter.
4. **Execute:** Engine reads the Worker's `.md` file, extracts frontmatter via `gray-matter` to configure the `CopilotClient` session, and injects the formatted prompt.
5. **Post-Process:** Worker returns raw text. Engine passes text to Output Adapter to extract status and data via Zod-validated JSON.
6. **State Update:** Save extracted data to Engine memory.
7. **Route:** Evaluate JSON `status` against AOML `<routing>` tags. Move to the next mapped step ID.

## **5\. Data Models & Interfaces**

### **5.1. Engine State (With Call Stack)**

```
interface EngineState {
  processName: string;
  currentStepId: string;
  variables: Map<string, any>; // Stores interpolated inputs/outputs
  callStack: Array<{           // Manages recursive sub-flow execution
    parentProcessName: string;
    returnStepId: string;
    variableContext: Map<string, any>;
  }>;
  executionTrace: Array<{
    stepId: string;
    agent: string;
    status: 'success' | 'fail' | 'approve' | 'reject' | 'escalated';
    latencyMs: number;
    tokensUsed: number;
    rawOutput: string;
    subTrace?: any[]; // Holds trace data for modular sub-flows
  }>;
}

```

### **5.2. Modular Sub-Flows (AOML Composable Schema)**

To promote DRY (Don't Repeat Yourself) principles, AOML supports modularity. A parent workflow can import another AOML file as a `<step>`, mapping its local variables into the child flow's `<globals>`.

**Parent Flow (feature-dev.xml):**

```
<step id="security-check" type="subflow" src="modules/security-audit.xml">
  <!-- Maps parent's `${{implemented_code}}` to child's expected `${{code_to_audit}}` -->
  <input map_to="code_to_audit">${{implemented_code}}</input>
  <output save_as="audit_report" />

  <routing>
    <!-- Routes based on the FINAL status of the sub-flow -->
    <on-status value="success" goto="deploy-phase" />
    <on-status value="fail" goto="notify-human" />
  </routing>
</step>

```

### **5.3. AOML Supported Tags Reference**

To standardize orchestration, the engine parses a strict set of XML tags. Below is the comprehensive vocabulary supported by AOML:

| Tag                | Attributes                                                            | Description                                                                                    |
| ------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `<process>`        | `name` (string), `type` (workflow, pipeline)                          | The root wrapper for the entire file.                                                          |
| `<trigger>`        | `type` (manual, schedule, webhook)                                    | Defines how the process is initiated.                                                          |
| `<globals>`        | None                                                                  | Wrapper for all global variables.                                                              |
| `<var>`            | `name` (string), `required` (boolean)                                 | Defines global variables expected at runtime (e.g., `${{ticket_id}}`).                         |
| `<steps>`          | None                                                                  | The container for all sequential or routed steps.                                              |
| `<step>`           | `id` (string), `agent` (persona), `type` (subflow), `src` (file path) | Represents a single agentic task or a modular sub-flow.                                        |
| `<input>`          | `format` (text, json), `map_to` (string)                              | The data injected into the agent's prompt. Supports `${{variable}}` interpolation.             |
| `<output>`         | `save_as` (string)                                                    | Defines the variable name where the agent's response data is stored in memory.                 |
| `<routing>`        | None                                                                  | Container for control-flow logic. Evaluated top-to-bottom.                                     |
| `<on-status>`      | `value` (string), `goto` (step_id), `pass_feedback` (boolean)         | Routes the workflow based on the agent's output status (e.g., "approve").                      |
| `<on-error>`       | `goto` (step_id), `retry_count` (int)                                 | Fallback routing if the agent fails to respond, crashes, or produces invalid output.           |
| `<on-max-retries>` | `goto` (step_id)                                                      | Escalation path. Where to route if an `<on-status>` or `<on-error>` loop hits its retry limit. |
| `<loop>`           | `source` (list var), `as` (item name), `mode` (parallel, sequential)  | Wraps a step to execute it multiple times concurrently or sequentially.                        |
| `<post-process>`   | None                                                                  | Runs only after the main `<steps>` block resolves (for auditing or grading).                   |
| `<evaluate>`       | `agent` (persona), `prompt` (file path)                               | A specialized step for a meta-agent to review the entire execution trace.                      |

### **5.4. Output Adapter Schema (Zod)**

```
const AdapterResponseSchema = z.object({
  status: z.string().describe("The routing status, e.g., 'approve' or 'reject'"),
  extractedData: z.string().describe("The clean code or summarized feedback"),
});
type AdapterResponse = z.infer<typeof AdapterResponseSchema>;

```

## **6\. Deployment & Integration Strategy (GitHub Native)**

The system requires zero external infrastructure. It is deployed and defined directly within the repository's `.github` directory.

### **6.1. Repository Structure**

```
.github/
├── agents/
│   ├── aoml-dispatcher.agent.md     # Exposes @aoml-dispatcher to Copilot Chat
│   ├── aoml-adapter.agent.md        # The translation/JSON extraction layer
│   ├── principal.agent.md           # Worker Node Persona
│   └── qa.agent.md                  # Worker Node Persona
├── skills/
│   └── run-aoml/
│       ├── SKILL.md                 # Chat/CLI connection mapping
│       └── run.sh                   # Invokes the TypeScript Engine
├── prompts/
│   └── developer.prompt.md          # Shared instruction sets
└── workflows/
    ├── feature-dev.xml              # Main workflow
    └── modules/
        └── security-audit.xml       # Reusable sub-flow imported by feature-dev

```

### **6.2. Parallel Execution (The Foreman Pattern)**

For tags like `<loop mode="parallel">`, the Engine acts as a "Foreman":

1. The Engine detects an array of inputs (e.g., `[file1.ts, file2.ts]`).
2. It provisions temporary Git Worktrees to prevent file I/O collisions.
3. It calls `CopilotClient.createSession()` simultaneously for each file.
4. Uses `Promise.all()` to await all Worker Nodes.
5. Merges Worktrees upon completion and aggregates output for the next step.

## **7\. Package Architecture (Monorepo Setup)**

To support seamless "Write Once, Run Anywhere" deployment across local and cloud environments, the codebase is structured as a TypeScript monorepo (e.g., utilizing npm/pnpm workspaces). This cleanly separates the pure logic from the environment-specific execution wrappers.

- `@aoml/core`: Contains the pure TypeScript state machine, the `fast-xml-parser` logic, the `zod` validations, `gray-matter` for parsing markdown configuration, and the abstract Copilot SDK interactions. It is completely decoupled from the filesystem or GitHub APIs.
- `@aoml/cli`: The local Node.js wrapper that reads from the local filesystem (`fs`) and prints interactive logs to `stdout`. It consumes `@aoml/core`.
- `@aoml/action`: The GitHub Actions wrapper. It uses `@actions/core` and `@actions/github` to read variables from YAML inputs, trigger the `@aoml/core` engine, and post the execution trace back to a PR comment or Issue.
- `@aoml/copilot`: The Extension/Agent wrapper, containing the configurations necessary to register the engine natively as a Copilot Extension/Skill.

## **8\. Installation & Usage**

### **8.1. Local Developer Installation**

Developers can install the CLI globally to run workflows directly from their terminal or bind it to their IDE tasks:

```
npm install -g @aoml/cli
aoml run .github/workflows/feature-dev.xml --ticket PROJ-123

```

### **8.2. Repository Onboarding**

To enable the `@aoml-dispatcher` agent in a repository, a maintainer only needs to copy the `.github/agents/aoml-dispatcher.agent.md` and associated XML workflow files into their repository. Once committed to the main branch, Copilot automatically registers the agent for all contributors.

### **8.3. Cloud Actions Setup**

To run as a CI/CD step, developers invoke the pre-packaged Action in their `.github/workflows/main.yml`:

```
jobs:
  run-aoml:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: aoml/action@v1
        with:
          workflow-file: '.github/workflows/nightly-qa.xml'
          github-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}

```

## **9\. Local vs. Remote Copilot Execution Environments**

Because the AOML Engine relies on the `@github/copilot-sdk`, its execution profile changes significantly based on whether the workflow is triggered interactively or asynchronously.

### **9.1. Local Execution (VS Code / Copilot CLI)**

- **Trigger Mechanism:** A developer types `@aoml-dispatcher run QA` in VS Code Copilot Chat or runs the command in their local terminal.
- **Execution Location:** The Engine runs locally on the developer's machine as a Node.js process.
- **Authentication:** The `@github/copilot-sdk` automatically piggybacks on the user's existing authenticated Copilot CLI token (OAuth). No extra API keys are needed.
- **Workspace Access:** The Engine has direct read/write access to the developer's uncommitted local files, making it ideal for rapid iteration and code generation before a commit.
- **Feedback Loop:** Execution traces stream live into the VS Code Chat window via the Dispatcher.

### **9.2. Remote Execution (GitHub Cloud Agents & Agent HQ)**

- **Trigger Mechanism:** A developer assigns `@aoml-dispatcher` to a GitHub Issue, uses the `/delegate` command in VS Code Chat, or triggers the GitHub Action.
- **Execution Location:** The Engine runs in an isolated, ephemeral GitHub Actions runner or a dedicated Copilot Cloud Agent VM.
- **Authentication:** Authentication is handled seamlessly by a Fine-Grained Personal Access Token (PAT) with Copilot scopes injected securely via repository secrets.
- **Workspace Access:** The Engine clones the repository into the secure cloud VM. Since it cannot access the developer's laptop, any code changes the Engine makes are submitted back to the repository autonomously by opening a Pull Request.
- **Feedback Loop:** Progress and final execution traces are reported asynchronously via GitHub Issue comments, PR summaries, or the GitHub Agent HQ Mission Control dashboard.

## **10\. Error Handling & Resilience**

- **LLM Hallucinations:** Handled by the Output Adapter's 3-attempt `try/catch` JSON parser loop.
- **Infinite Loops:** The AOML schema enforces `retry_count` limits on `<on-status>` routing. Exceeding the limit triggers `<on-max-retries>` (usually mapping to an escalation Meta-Agent or human intervention).
- **Timeout:** The Copilot SDK API wrapper includes strict network timeouts. Engine halts and preserves `executionTrace` state for recovery if an API drops.
-
