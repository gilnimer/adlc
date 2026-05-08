# **Product Requirements Document (PRD)**

**Product Name:** AOML Orchestration Engine (Agentic Orchestration Markup Language)

**Document Status:** Draft / Discovery Phase

**Target Platform:** Local (CLI), IDE (GitHub Copilot Extension), Cloud (GitHub Actions / Agent HQ)

## **1\. Executive Summary**

The AOML Orchestration Engine is a hybrid multi-agent orchestration framework. It aims to solve the fragility and high latency of pure LLM-orchestrated systems by introducing a **"Goldilocks Architecture"**. It pairs a strict, deterministic state-machine engine with lightweight "Adapter Agents" to manage control flow, allowing complex "Worker Agents" (Principal, Developer, QA) to operate flexibly without breaking system state.

## **2\. Core Vocabulary & Concepts**

- **AOML (Agentic Orchestration Markup Language):** The XML-based schema used to define pipelines, workflows, and loops.
- **The Engine:** A deterministic TypeScript-based state machine. It parses AOML, manages variables, and executes routing logic. It does _not_ utilize LLMs for decision-making.
- **Adapter Agents:** Fast, low-cost LLM calls (e.g., GPT-4o-mini). They act as translators, converting strict engine state into readable prompts, and converting conversational worker outputs into strict JSON for the Engine.
- **Worker Agents:** The heavy-lifting domain experts (e.g., Principal, Dev, QA) using frontier models.
- **Meta-Agents:** Agents that run post-process or during escalations to audit, grade, or intervene in the workflow.

## **3\. System Architecture**

The system operates on an "Adapter Pattern Sandwich" for every task defined in the AOML:

1. **Pre-Process (Input Adapter):** Engine state \+ variables ![][image1] Adapter Agent ![][image1] Clean Prompt.
2. **Execution (Worker Node):** Clean Prompt ![][image1] Worker Agent ![][image1] Conversational/Raw Output.
3. **Post-Process (Output Adapter):** Raw Output ![][image1] Adapter Agent ![][image1] Strict JSON ({status, data}).
4. **Routing (Engine):** Engine reads JSON status ![][image1] updates state ![][image1] executes XML \<routing\> rules.

## **4\. Product Requirements (Functional)**

### **4.1. AOML Parser & Execution**

- **Feature:** The Engine must parse .xml/.aoml files containing \<process\>, \<step\>, \<input\>, \<output\>, \<routing\>, and \<loop\> tags.
- **Feature:** The Engine must resolve global and local variables (e.g., ${{ticket\_id}}) across steps.
- **Feature:** The Engine must handle synchronous and parallel execution of \<loop\> tags.

### **4.2. Local Execution (CLI)**

- **Feature:** Developers must be able to run the engine locally via a CLI command.
  - _Example:_ aoml run workflows/feature-dev.xml \--ticket PROJ-123
- **Feature:** The CLI must output real-time execution logs (which agent is running, current routing path).

### **4.3. GitHub Ecosystem Integration**

- **GitHub Copilot Extension:**
  - The Engine must be exposed as a Copilot Chat participant (e.g., @aoml).
  - Users can trigger workflows directly from their IDE chat: _"@aoml run the qa-pipeline on my open files."_
  - The extension utilizes the local workspace context to feed the Engine.
- **GitHub Actions / GitHub Agent HQ (Cloud):**
  - The Engine must be packageable as a custom GitHub Action.
  - It should trigger automatically based on GitHub webhooks (e.g., on: pull_request, on: issues).
  - Outputs (like QA reports) should be written directly back to the GitHub UI as PR comments or Issue updates.

### **4.4. Telemetry & Auditing**

- **Feature:** The Engine must generate a structured execution trace (JSON log) of every step, including token usage, latency, routing decisions, and raw LLM outputs.
- **Feature:** The system must support \<post-process\> \<evaluate\> tags to allow Meta-Agents to grade the telemetry trace upon completion.

## **5\. Technical & Non-Functional Requirements**

- **Language:** TypeScript / Node.js (To ensure seamless compatibility between local CLI, VS Code Copilot extensions, and GitHub Actions).
- **LLM Provider Agnosticism:** The Engine/Adapters must be capable of calling different models (e.g., OpenAI, Anthropic, or GitHub Copilot's internal models via the extension API).
- **Cost Optimization:** Adapter Agents must default to fast/cheap models to prevent token bloat during the translation phases.

## **6\. Out of Scope (For V1)**

- Visual Drag-and-Drop builder for AOML files.
- Self-optimizing Meta-Agents that automatically rewrite AOML files (Optimizers).

## **7\. Next Steps: Technical Discovery**

1. Define the exact TypeScript interfaces for the Engine State.
2. Map out the Copilot Extension API lifecycle vs. the GitHub Action lifecycle.
3. Draft the core parsing algorithm for the \<routing\> tags.

[image1]: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAAXCAYAAADpwXTaAAAAl0lEQVR4XmNgGAWjgHpAQUGhEF2MbAA0bKGMjIwqujhZQE5OzlpeXn4bujjZAGhYNtDQNHRxBqCThWRlZaVIxUADlwLxWhAbbhgwDDqBgstJxUCXnQTS/4B0PZLbSAdA36gADdoLCj90OZIA0CccQIOuSEtLy6DLkQyABqUAcTG6OFkAaNB+IMWCLk4WABomiS42CgYBAABUyybk/x0YCgAAAABJRU5ErkJggg==
