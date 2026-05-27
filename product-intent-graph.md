**Product Intent Graph**

Detailed concept document, MVP scope, and PRD

 

*A system for translating PM intent into structured, finite, verifiable product work.*

 

Prepared for: Gil Nimer  
 Version: Draft 1.0  
 Date: May 24, 2026

 

# 

# 

# 

# 

# 

# 

# 

# 

# **Table of Contents**

1\.   	1\. Executive Summary  
2\.   	2\. Core Thesis  
3\.   	3\. Problem Statement  
4\.   	4\. Conceptual Model  
5\.   	5\. Intent Graph Structure  
6\.   	6\. Translating User Stories into the Graph  
7\.   	7\. Finiteness, Satisfaction Boundaries, and Done  
8\.   	8\. Human Visualization Model  
9\.   	9\. Agent Execution Model  
10\.   10\. Figma and Visual Intent Integration  
11\.   11\. Evidence and Verification  
12\.   12\. System Architecture  
13\.   13\. MVP Scope  
14\.   14\. Product Requirements Document (PRD)  
15\.   15\. Risks and Open Questions  
16\.   16\. Appendix: Example Data Structures

 

# 

# 

# 

# 

# 

# 

# **1\. Executive Summary**

Product teams usually translate intent into tickets. Tickets are useful for coordination, but they flatten product meaning. A ticket rarely preserves the full chain of reasoning: who the work is for, what need it serves, where in the journey it belongs, what outcome it supports, how it should be visually expressed, what conditions must be true, and what evidence proves it is done.

The Product Intent Graph is a proposed system that makes product intent the primary object. Instead of treating user stories as isolated backlog items, the system turns them into a structured graph of segments, needs, capabilities, journey steps, outcomes, metrics, constraints, assumptions, acceptance conditions, and design expressions. AI agents then use this graph as an execution contract: they generate implementation plans, QA plans, analytics plans, and design coverage checks from the graph.

The core loop is finite. An approved intent version has a satisfaction boundary: a declared scope, required conditions, constraints, exclusions, and verification policy. The loop ends when all required conditions are verified or explicitly waived. Later change requests create new intent versions rather than endlessly expanding the current one.

User Story → Intent Graph → Satisfaction Boundary → Acceptance Conditions → Agent Work Packages → Evidence → Satisfied

The MVP should focus on the narrowest high-value slice: convert PM user stories into structured intent cards and graph nodes; allow users to define acceptance conditions and scope; link Figma frames manually or via tagged metadata; generate role-specific work packages for engineering, QA, design, and data; and show whether each intent has sufficient design/condition coverage.

# 

# 

# 

# **2\. Core Thesis**

In the AI era, product managers should not have to express product intent primarily as tickets. They should express desired product reality in structured language. The system should then preserve, expand, validate, visualize, and operationalize that intent.

The central thesis can be stated as:

Product management shifts from writing tickets to maintaining a finite, versioned graph of product intent that agents can execute against and humans can reason about.

This implies several design principles:

·         Intent should be structured, not merely prose.  
·         A user story should be treated as a source artifact, not the main unit of product truth.  
·         Acceptance conditions are the bridge between product meaning and implementation work.  
·         Designs in Figma are visual expressions of intent, not merely attachments.  
·         AI agents should operate on typed subgraphs, not vague natural-language tickets.  
·         Each intent version must have a satisfaction boundary so the loop can end.  
·         Evidence and verification should connect back to conditions, not float separately in QA systems.

# **3\. Problem Statement**

Most product organizations rely on a fragmented chain of artifacts: discovery notes, user stories, Jira tickets, Figma files, engineering tasks, QA cases, analytics events, launch checklists, and post-release dashboards. The meaning of the product intent is scattered across these systems. As a result, teams lose traceability between why something matters and what was actually built.

## **3.1 Symptoms**

·         PMs write user stories, but engineers receive tasks disconnected from user value.  
·         Designs express intent visually, but the relationship between design states and acceptance criteria is informal.  
·         QA verifies behavior, but test cases are often not directly linked to product intent.  
·         Analytics events are added late or inconsistently, making success hard to evaluate.  
·         Change requests reopen work without clear versioning of the original intent.  
·         AI coding agents lack structured product context, so they overfit to local implementation details or hallucinate requirements.  
·         Teams cannot easily answer: “Is this intent fully realized, partially realized, or unverified?”

## **3.2 Root Cause**

The root cause is that the product intent is not represented as a durable, structured object. It exists as prose, comments, designs, and tickets. These artifacts are useful, but none of them is a complete model of product meaning.

Traditional flow: Research → User story → Ticket → Design → Code → QA → Release

 Problem: the chain is lossy. Each step drops context.

# **4\. Conceptual Model**

The Product Intent Graph separates product meaning into typed nodes and typed relationships. It is not a graph of all reality. It is a graph of intended product reality: what should be true, for whom, where, why, and under which conditions.

Intent Graph \= structured representation of desired product reality

## **4.1 Four conceptual layers**

| Layer | Question | Examples |
| :---- | :---- | :---- |
| Product Intent | What should be true and why? | Segment, need, capability, outcome, journey step, metric |
| Visual Intent | How should the intent appear and behave? | Figma frame, component, state, copy, interaction |
| Satisfaction Boundary | Where does this intent version end? | Scope, exclusions, required conditions, verification policy |
| Execution/Evidence | What work and proof are needed? | Generated work package, tests, analytics plan, design coverage, evidence links |

 

## **4.2 Key loop**

Declare intent  
   ↓  
 Structure intent graph  
   ↓  
 Define satisfaction boundary  
   ↓  
 Generate acceptance conditions  
   ↓  
 Generate agent work packages  
   ↓  
 Implement / design / test / measure  
   ↓  
 Attach evidence  
   ↓  
 Mark intent satisfied or create deltas

# **5\. Intent Graph Structure**

The graph consists of nodes and edges. Nodes represent product concepts. Edges represent relationships between those concepts.

## **5.1 Core node types**

| Node Type | Definition | Example |
| :---- | :---- | :---- |
| Story Source | The original human-readable user story or PM statement. | “As a returning customer, I want to reuse my saved address…” |
| Segment / Persona | The user group or actor the intent is for. | Returning Customer, New User, Admin, Merchant |
| Need | The user problem, friction, desire, or job. | Faster Checkout, Choose Right Plan |
| Capability | What the product should enable. | Reuse Saved Shipping Address, Plan Guidance |
| Journey | A broader user flow. | Checkout, Onboarding, Subscription Purchase |
| Journey Step | A specific moment in a journey. | Checkout Shipping Address Step, Pricing Page |
| Outcome | The user or business result the capability should support. | Reduced Checkout Friction, Subscription Confidence |
| Metric | How success or health is measured. | Checkout Completion Rate, Time to Checkout |
| Constraint | A hard boundary or rule. | Consent Required, Domestic Addresses Only |
| Assumption | A belief that influences the intent but may not be proven. | Users are confused by plan differences |
| Acceptance Condition | A finite condition that must be true for the intent to count as realized. | Saved address option is visible |
| Design Coverage Requirement | A required visual state/surface/interaction for the intent. | Mobile selected state, Desktop error state |
| Visual Intent Artifact | A linked design object expressing part of the intent. | Figma frame, component, variant, prototype interaction |

 

## **5.2 Core edge types**

| Edge Type | Meaning | Example |
| :---- | :---- | :---- |
| expresses | A source story expresses one or more graph nodes. | Story expresses Capability: Reuse Saved Address |
| has\_need | A segment/persona has a need. | Returning Customer has\_need Faster Checkout |
| satisfied\_by | A need is addressed by a capability. | Faster Checkout satisfied\_by Reuse Saved Address |
| expected\_at | A capability belongs at a journey step. | Reuse Saved Address expected\_at Checkout Address Step |
| supports | A node contributes to an outcome. | Reuse Saved Address supports Reduced Checkout Friction |
| measured\_by | An outcome/capability is evaluated by a metric. | Reduced Friction measured\_by Time to Checkout |
| constrained\_by | A capability is limited by a rule. | Reuse Saved Address constrained\_by Consent Required |
| assumes | The intent depends on a hypothesis. | Plan Guidance assumes Users are confused by plan differences |
| requires\_condition | A capability requires an acceptance condition. | Reuse Saved Address requires\_condition Address Selectable |
| requires\_design\_coverage | A condition requires a visual expression. | Address Selectable requires\_design\_coverage Mobile Selected State |
| visually\_defined\_by | A condition is represented in design. | Mobile Selected State visually\_defined\_by Figma Frame 12:45 |
| depends\_on | One capability depends on another. | Saved Address depends\_on User Identity |
| part\_of | A journey step belongs to a journey. | Checkout Address Step part\_of Checkout |

 

## **5.3 Minimal data schema**

{  
   "nodes": \[  
 	{  
   	"id": "capability.reuse\_saved\_address",  
   	"type": "Capability",  
   	"name": "Reuse Saved Shipping Address",  
   	"description": "Eligible users can select a previously saved shipping address during checkout.",  
   	"status": "approved",  
   	"owner": "product",  
   	"version": "v1",  
   	"confidence": 0.9  
 	}  
   \],  
   "edges": \[  
 	{  
   	"from": "need.faster\_checkout",  
   	"to": "capability.reuse\_saved\_address",  
   	"type": "satisfied\_by",  
   	"confidence": 0.9  
 	}  
   \]  
 }

# **6\. Translating User Stories into the Graph**

A classic user story has three parts: persona, desired capability, and benefit. The graph expands those three parts into a richer product model.

As a \<segment/persona\>, I want \<capability\>, so that \<need/outcome\>.

## **6.1 Transformation pattern**

| User Story Part | Graph Element | Notes |
| :---- | :---- | :---- |
| As a returning customer | Segment / Persona | The actor or user group. |
| I want to reuse my saved shipping address | Capability | The product behavior to enable. |
| So that I can checkout faster | Need \+ Outcome | The user need and expected result. |
| Acceptance criteria | Acceptance Conditions | Finite conditions that prove realization. |
| Where in product | Journey Step | The moment where the capability should appear. |
| KPI | Metric | Measurement of the outcome or behavior. |
| Rules / policies | Constraints | Boundaries that must not be violated. |
| Beliefs | Assumptions | Hypotheses that should be validated later. |

 

## **6.2 Example: saved shipping address**

User story:  
 As a returning customer,  
 I want to reuse my saved shipping address,  
 so that I can checkout faster.

Intent graph representation:

\[Segment: Returning Customer\]  
   has\_need → \[Need: Faster Checkout\]

 \[Need: Faster Checkout\]  
   satisfied\_by → \[Capability: Reuse Saved Shipping Address\]

 \[Capability: Reuse Saved Shipping Address\]  
   expected\_at → \[Journey Step: Checkout / Shipping Address\]  
   supports → \[Outcome: Reduced Checkout Friction\]  
   measured\_by → \[Metric: Time to Checkout\]  
   measured\_by → \[Metric: Checkout Completion Rate\]  
   constrained\_by → \[Constraint: User must have a saved address\]  
   constrained\_by → \[Constraint: Consent required\]  
   requires\_condition → \[Condition: Saved address option is visible\]  
   requires\_condition → \[Condition: Saved address can be selected\]  
   requires\_condition → \[Condition: Selected address can be edited\]  
   requires\_condition → \[Condition: User can continue checkout after selection\]  
   requires\_condition → \[Condition: Saved address usage is tracked\]

## **6.3 JSON example**

{  
   "story": {  
 	"id": "story.checkout.reuse\_saved\_address",  
 	"source\_text": "As a returning customer, I want to reuse my saved shipping address, so that I can checkout faster.",  
 	"status": "approved"  
   },  
   "nodes": \[  
 	{"id": "segment.returning\_customer", "type": "Segment", "name": "Returning Customer"},  
 	{"id": "need.faster\_checkout", "type": "Need", "name": "Faster Checkout"},  
 	{"id": "capability.reuse\_saved\_address", "type": "Capability", "name": "Reuse Saved Shipping Address"},  
 	{"id": "journey\_step.checkout\_shipping", "type": "JourneyStep", "name": "Checkout Shipping Address"},  
 	{"id": "outcome.reduced\_checkout\_friction", "type": "Outcome", "name": "Reduced Checkout Friction"},  
 	{"id": "metric.time\_to\_checkout", "type": "Metric", "name": "Time to Checkout"},  
 	{"id": "condition.address\_visible", "type": "AcceptanceCondition", "name": "Saved Address Option Is Visible"},  
 	{"id": "condition.address\_selectable", "type": "AcceptanceCondition", "name": "Saved Address Can Be Selected"}  
   \],  
   "edges": \[  
 	{"from": "segment.returning\_customer", "to": "need.faster\_checkout", "type": "has\_need"},  
 	{"from": "need.faster\_checkout", "to": "capability.reuse\_saved\_address", "type": "satisfied\_by"},  
 	{"from": "capability.reuse\_saved\_address", "to": "journey\_step.checkout\_shipping", "type": "expected\_at"},  
 	{"from": "capability.reuse\_saved\_address", "to": "outcome.reduced\_checkout\_friction", "type": "supports"},  
 	{"from": "outcome.reduced\_checkout\_friction", "to": "metric.time\_to\_checkout", "type": "measured\_by"},  
 	{"from": "capability.reuse\_saved\_address", "to": "condition.address\_visible", "type": "requires\_condition"},  
 	{"from": "capability.reuse\_saved\_address", "to": "condition.address\_selectable", "type": "requires\_condition"}  
   \]  
 }

# **7\. Finiteness, Satisfaction Boundaries, and Done**

The graph can conceptually expand forever, but any approved intent version must be finite. The system needs an explicit stopping mechanism called a satisfaction boundary.

## **7.1 Satisfaction boundary**

A satisfaction boundary defines where the intent ends for a particular version.

·         Included segments and personas  
·         Included surfaces and platforms  
·         Included journeys and journey steps  
·         Included states and scenarios  
·         Explicit exclusions  
·         Required acceptance conditions  
·         Verification policy  
·         Waiver policy  
·         Version identifier

## **7.2 Example boundary**

Intent: checkout.reuse\_saved\_address.v1

 Scope:  
 \- Logged-in returning customers  
 \- Web and mobile checkout  
 \- Users with at least one saved domestic shipping address  
 \- Standard single-shipment checkout

 Out of scope:  
 \- Guest users  
 \- International addresses  
 \- Multiple shipments  
 \- B2B bulk orders

 Completion rule:  
 \- Intent is satisfied when all required conditions are verified or waived by the PM owner.

## **7.3 Why this matters for agents**

Without a satisfaction boundary, agents may keep adding edge cases, states, and requirements. The boundary tells agents what counts, what does not count, and when to stop.

Agent guardrails:  
 \- Do not add required conditions without approval.  
 \- Do not expand scope without approval.  
 \- Do not treat optional/future items as blockers.  
 \- Do not mark intent satisfied without evidence.  
 \- Create a change request for newly discovered scope.

# **8\. Human Visualization Model**

Humans should not start with a giant node-link graph. The graph should power multiple product-friendly views. The full graph explorer is useful, but it should not be the default interface.

## **8.1 Visualization levels**

| Level | View | Primary User | Purpose |
| :---- | :---- | :---- | :---- |
| 1 | Intent Card | PMs, stakeholders | Show the structured intent in a readable format. |
| 2 | Intent Chain | PMs, designers, engineers | Show Who → Need → Capability → Journey → Outcome → Metric. |
| 3 | Journey Overlay | PMs and designers | Show where the intent lives in the user journey. |
| 4 | Condition Matrix | PMs, QA, engineering | Show conditions, status, priority, owner, and evidence. |
| 5 | Design Coverage View | PMs and designers | Show linked Figma frames/states and missing visual coverage. |
| 6 | Agent Work Package View | Engineering, QA, data | Show generated implementation/test/analytics/design work. |
| 7 | Full Graph Explorer | Advanced users | Inspect relationships and impact across the system. |

 

## **8.2 Intent card example**

Intent: Reuse Saved Shipping Address

 Segment: Returning Customer  
 Need: Faster Checkout  
 Capability: Reuse saved shipping address  
 Journey Step: Checkout / Shipping Address  
 Outcome: Reduced checkout friction  
 Metrics: Checkout completion rate, time to checkout  
 Scope: Logged-in returning users with saved domestic address  
 Acceptance Conditions:  
 \- Saved address option is visible  
 \- Saved address can be selected  
 \- Selected address can be edited  
 \- User can continue checkout after selection  
 \- Usage is tracked

## **8.3 Condition matrix example**

| Condition | Priority | Coverage | Status |
| :---- | :---- | :---- | :---- |
| Saved address option is visible | High | Web \+ mobile | Ready |
| Saved address can be selected | High | Web \+ mobile | Ready |
| Selected address can be edited | Medium | Web \+ mobile | Needs design |
| Invalid saved address has recovery path | Medium | Web \+ mobile | Missing |
| Usage is tracked | Medium | Analytics event | Ready |

 

# **9\. Agent Execution Model**

Agents should use the graph as an execution contract. They should not receive only a user story. They should receive a role-specific subgraph containing intent, conditions, constraints, scope, and relevant design artifacts.

## **9.1 Agent workflow**

1\. Read approved intent version.  
 2\. Read satisfaction boundary.  
 3\. Read required acceptance conditions.  
 4\. Retrieve role-specific subgraph.  
 5\. Generate work package.  
 6\. Map work package to likely implementation/design/test/data artifacts.  
 7\. Ask for approval if scope or mapping is uncertain.  
 8\. Produce changes or plans.  
 9\. Attach evidence back to conditions.  
 10\. Update realization status.

## **9.2 Role-specific agents**

| Agent | Consumes | Produces |
| :---- | :---- | :---- |
| Product Agent | Segment, need, capability, outcome, metric, assumptions | Clarified intent, missing conditions, risks, priority suggestions |
| Design Agent | Journey step, capability, conditions, constraints, Figma links | State list, design gaps, copy needs, accessibility considerations |
| Engineering Agent | Capability, conditions, scope, constraints, dependencies | Implementation plan, affected components, API needs, state changes |
| QA Agent | Conditions, scope, constraints, journey step, segment | Test scenarios, edge cases, coverage matrix |
| Data Agent | Outcome, metric, conditions, analytics needs | Tracking plan, event schema, dashboard requirements |

 

## **9.3 Work package example**

Agent work package: Reuse Saved Shipping Address

 Frontend:  
 \- Add SavedAddressSelector to CheckoutAddressStep.  
 \- Support empty, one-address, multiple-address, selected, edit, loading, and error states.  
 \- Place selector before manual address form.

 Backend/API:  
 \- Retrieve saved addresses for authenticated user.  
 \- Validate selected address before payment.  
 \- Return recoverable errors for invalid saved addresses.

 Analytics:  
 \- Emit saved\_address\_selector\_shown.  
 \- Emit saved\_address\_selected.  
 \- Emit saved\_address\_fallback\_to\_manual.

 QA:  
 \- Test desktop and mobile.  
 \- Test user with one address, multiple addresses, no addresses, invalid address.  
 \- Test continuation to payment.

 Design:  
 \- Provide mobile and desktop frames for default, selected, empty, loading, and invalid states.

# **10\. Figma and Visual Intent Integration**

Figma should not be fully synchronized into the graph. Full sync is too noisy. The system should sync design intent anchors: selected frames, components, states, variants, links, statuses, and annotations that carry product meaning.

## **10.1 Principle**

Do not sync Figma. Sync design intent anchors from Figma.

A design artifact is linked to an intent node only when it expresses product meaning.

## **10.2 Figma integration levels**

| Level | Mechanism | Value | Complexity |
| :---- | :---- | :---- | :---- |
| 1 | Manual links | Users paste Figma frame links into intent/condition nodes. | Low |
| 2 | Tagged frames | Designers tag frames with intent IDs; system imports metadata. | Medium |
| 3 | Semantic parsing | AI reads design structure and suggests missing states/conditions. | High |
| 4 | Bidirectional generation | Graph creates draft design briefs or frames. | Very high / future |

 

## **10.3 Design coverage layer**

The design coverage layer is the finite bridge between product intent and Figma.

Capability / Condition  
   → requires\_design\_coverage  
   → Design Coverage Requirement  
   → fulfilled\_by  
   → Figma Frame / Component / Variant

## **10.4 Example**

\[Capability: Reuse Saved Address\]  
   requires\_condition → \[Condition: Saved address selectable\]

 \[Condition: Saved address selectable\]  
   requires\_design\_coverage → \[Coverage: Mobile selected state\]  
   requires\_design\_coverage → \[Coverage: Desktop selected state\]

 \[Coverage: Mobile selected state\]  
   fulfilled\_by → \[Figma Frame: Mobile Checkout Address \- Selected\]

 \[Coverage: Desktop selected state\]  
   fulfilled\_by → \[Figma Frame: Desktop Checkout Address \- Selected\]

## **10.5 Design gaps**

| Gap Type | Meaning | Example |
| :---- | :---- | :---- |
| Missing design expression | No design artifact is linked to the intent. | Capability exists but no Figma frame. |
| Missing state | A required state is not designed. | No invalid-address state. |
| Responsive gap | One platform is covered but another is not. | Desktop exists, mobile missing. |
| Interaction gap | Visual frame exists but behavior is unclear. | Edit action exists but flow not specified. |
| Copy gap | UI copy does not explain the intended value. | Selector label unclear. |
| Accessibility gap | Design lacks required accessibility considerations. | No focus order or screen-reader label. |
| Design-system gap | Design uses unapproved or unavailable components. | Custom selector instead of design-system card/radio. |

 

# **11\. Evidence and Verification**

The intent graph itself does not prove reality. Evidence comes later from tests, QA, analytics, runtime observations, design review, and implementation artifacts. The graph should be designed so evidence can attach to acceptance conditions.

Intent → Acceptance Condition → Evidence → Status

## **11.1 Evidence types**

| Evidence Type | What it can prove | Caution |
| :---- | :---- | :---- |
| Automated E2E test | A flow works technically. | May not prove usability or clarity. |
| Unit/integration test | A logic or service behavior works. | May not prove user-facing experience. |
| Manual QA result | A human observed expected behavior. | Can become stale. |
| Figma link | Visual intent exists. | Does not prove implementation. |
| Analytics event | Measurement exists or behavior occurred. | Missing events may mean missing tracking, not missing behavior. |
| Production logs | System behavior occurred. | May need interpretation. |
| Support/user feedback | A real problem or confusion exists. | Anecdotal unless patterned. |

 

## **11.2 Status model**

| Status | Meaning |
| :---- | :---- |
| Draft | Intent is being defined. |
| Approved | Intent is accepted and can generate work. |
| In Realization | Work is ongoing. |
| Partially Verified | Some required conditions are verified. |
| Verified | All required conditions have evidence. |
| Satisfied | Intent version is complete under its satisfaction boundary. |
| Superseded | A newer intent version replaced this one. |
| Deprecated | Intent is no longer active. |

 

# **12\. System Architecture**

The MVP architecture should be modular and graph-first, but it does not need a complex graph database on day one. A relational database with typed nodes and edges can work initially.

## **12.1 Logical components**

| Component | Responsibility |
| :---- | :---- |
| Intent Workspace | UI for PMs to create and edit intent cards and graph structures. |
| Graph Store | Stores typed nodes, edges, versions, statuses, and source references. |
| AI Parser | Converts user stories and PM prose into proposed graph nodes and edges. |
| Condition Generator | Proposes acceptance conditions and satisfaction boundaries. |
| Visualization Layer | Renders cards, chains, journey overlays, matrices, and graph explorer. |
| Figma Linker | Stores manual Figma links and later syncs tagged Figma metadata. |
| Agent Work Package Generator | Creates role-specific work packages from subgraphs. |
| Evidence Layer | Allows links to tests, QA results, design coverage, or analytics plans. |

 

## **12.2 Architecture diagram**

PM / Designer / Engineer UI  
       	↓  
 Intent Workspace  
       	↓  
 AI Parser \+ Condition Generator  
       	↓  
 Product Intent Graph Store  
       	↓  
 Visualization Layer  ←→  Figma Linker  
       	↓  
 Agent Work Package Generator  
       	↓  
 Design / Engineering / QA / Data Plans  
       	↓  
 Evidence Links \+ Status Rollups

# **13\. MVP Scope**

The MVP should prove one thing: structured product intent can replace or augment user stories as the central artifact for PM-to-agent execution. It should not attempt full codebase understanding, full Figma parsing, full Jira replacement, or autonomous implementation.

## **13.1 MVP goal**

Help a PM turn a user story into a finite, visual, agent-readable intent graph with acceptance conditions, design coverage, and generated work packages.

## **13.2 MVP target users**

| User | Need in MVP |
| :---- | :---- |
| Product Manager | Create structured intent from user stories and know whether the intent is well specified. |
| Designer | Link Figma frames to intent and see missing visual states. |
| Engineer | Receive a clear implementation work package with scope, constraints, and conditions. |
| QA / Data teammate | Receive test or tracking plan derived from conditions. |

 

## **13.3 MVP features**

| Feature | Description | Priority |
| :---- | :---- | :---- |
| User story parser | Paste a user story or PM statement and generate proposed nodes: segment, need, capability, journey step, outcome, metric, conditions. | P0 |
| Intent card editor | Human-editable form for structured intent fields. | P0 |
| Graph data model | Store typed nodes and edges with IDs, statuses, owners, and versions. | P0 |
| Satisfaction boundary editor | Define scope, exclusions, required conditions, and done policy. | P0 |
| Acceptance condition generator | AI proposes finite conditions from capability \+ scope. | P0 |
| Intent chain visualization | Show Who → Need → Capability → Journey → Outcome → Metric. | P0 |
| Condition matrix | Show conditions, priority, status, owner, and linked evidence/design. | P0 |
| Manual Figma linking | Attach Figma frame/component links to conditions or coverage items. | P0 |
| Design coverage checklist | Generate required visual states/surfaces and show coverage/missing states. | P1 |
| Agent work package generator | Generate role-specific packages for engineering, QA, design, and analytics. | P0 |
| Export to Markdown/Jira/GitHub issue | Export generated work packages into existing tools. | P1 |
| Basic evidence linking | Attach links to tests, docs, QA results, analytics plans. | P1 |
| Versioning | Create new intent versions when change requests appear. | P1 |

 

## **13.4 Explicitly out of scope for MVP**

·         Full autonomous implementation against a codebase.  
·         Automatic codebase-to-reality graph generation.  
·         Full Figma layer ingestion.  
·         Pixel-perfect design-to-code verification.  
·         Replacing Jira/Linear/Azure DevOps entirely.  
·         Production analytics ingestion.  
·         Complex permissions and enterprise governance.  
·         Cross-team portfolio planning.  
·         Automated bidirectional Figma editing.

## **13.5 MVP success criteria**

| Metric | Target |
| :---- | :---- |
| Time to structure a user story | Under 5 minutes for a PM to paste, review, and approve an intent card. |
| Condition completeness | At least 80% of generated acceptance conditions are accepted or edited rather than discarded. |
| Work package usefulness | At least 70% of engineers/QA/designers rate generated packages as useful. |
| Design coverage value | PM/design users identify missing states or surfaces in at least 50% of pilot intents. |
| Traceability | Every generated work package traces back to at least one condition and one capability. |

 

# **14\. Product Requirements Document (PRD)**

## **14.1 Product name**

Working name: Product Intent Graph. Alternative names: Product Realization Graph, IntentOS, Product Intent OS, Product Meaning Graph.

## **14.2 One-liner**

A workspace that turns PM user stories into finite, structured product intent graphs that humans can visualize and AI agents can execute against.

## **14.3 Problem**

Product intent is currently spread across user stories, tickets, designs, QA cases, analytics plans, and Slack discussions. This makes it hard for humans and AI agents to know what exactly must be true for a product idea to be considered realized.

## **14.4 Goals**

·         Create a structured representation of product intent from natural-language user stories.  
·         Make intent finite through scope and satisfaction boundaries.  
·         Generate acceptance conditions that serve as the execution contract.  
·         Visualize intent in PM-friendly views, not only raw graphs.  
·         Connect visual intent from Figma through manual links and coverage requirements.  
·         Generate agent-readable work packages for engineering, QA, design, and data.  
·         Prepare a foundation for future evidence-backed realization tracking.

## **14.5 Non-goals**

·         Automatically determine whether code fully matches product intent.  
·         Replace all existing project management tools in MVP.  
·         Perform full Figma semantic understanding in MVP.  
·         Guarantee implementation correctness without tests or evidence.  
·         Optimize user behavior or model live user behavior in MVP.

## **14.6 Personas**

| Persona | Jobs to be Done |
| :---- | :---- |
| Product Manager | Translate an idea/user story into structured intent; define done; communicate clearly to agents and humans. |
| Product Designer | Understand what product intent the design must express; link Figma states and identify missing states. |
| Engineer | Understand scope, constraints, conditions, and intended outcomes before implementation. |
| QA Engineer | Create tests directly from acceptance conditions and scope. |
| Data/Analytics Partner | Create measurement plans tied to outcomes and conditions. |
| AI Agent | Consume the graph as structured context and produce bounded work packages. |

 

## **14.7 Primary user journey**

17\.   PM creates a new intent by pasting a user story or writing a PM statement.  
18\.   AI proposes structured nodes: segment, need, capability, journey step, outcome, metrics, constraints, assumptions.  
19\.   PM reviews and edits the intent card.  
20\.   AI proposes a satisfaction boundary and acceptance conditions.  
21\.   PM marks conditions as required, optional, future, or out of scope.  
22\.   Designer links Figma frames or marks design coverage as missing.  
23\.   System shows intent chain, condition matrix, and design coverage status.  
24\.   PM generates role-specific work packages.  
25\.   Team exports work packages to existing execution tools or uses them directly.  
26\.   Evidence links are attached later to conditions, enabling realization status rollup.

## **14.8 Functional requirements**

| ID | Requirement | Priority |
| :---- | :---- | :---- |
| FR-1 | User can create an intent from free text or a structured user story. | P0 |
| FR-2 | System proposes graph nodes and edges from the source text. | P0 |
| FR-3 | User can edit all proposed nodes and relationships before approval. | P0 |
| FR-4 | System stores intent versions with status and owner. | P0 |
| FR-5 | User can define scope, exclusions, constraints, and satisfaction policy. | P0 |
| FR-6 | System proposes acceptance conditions from capability and scope. | P0 |
| FR-7 | User can classify conditions as required, optional, future, waived, or out of scope. | P0 |
| FR-8 | System displays an intent card and intent chain visualization. | P0 |
| FR-9 | System displays a condition matrix with status and ownership. | P0 |
| FR-10 | User can manually link Figma URLs to capabilities, conditions, or design coverage items. | P0 |
| FR-11 | System can generate design coverage requirements for key states/surfaces. | P1 |
| FR-12 | System can generate role-specific work packages. | P0 |
| FR-13 | User can export work packages to Markdown, Jira-style tickets, GitHub issues, or Linear-style tasks. | P1 |
| FR-14 | User can attach evidence links to acceptance conditions. | P1 |
| FR-15 | System can roll up condition statuses into intent status. | P1 |

 

## **14.9 Non-functional requirements**

| Area | Requirement |
| :---- | :---- |
| Usability | A PM should be able to create and approve a first intent in under 5 minutes. |
| Explainability | AI-generated nodes and conditions must show the source text or reasoning basis. |
| Editability | Every AI-generated element must be human-editable. |
| Traceability | Every work package item must link back to a condition and capability. |
| Versioning | Change requests must create new intent versions or explicit edits to current versions. |
| Interoperability | MVP should export to existing tools rather than forcing replacement. |
| Security | Sensitive product data and Figma links should be access-controlled. |
| Reliability | The graph should preserve stable IDs for nodes and edges across edits. |

 

## **14.10 Data model overview**

Entity: Intent  
 \- id  
 \- name  
 \- version  
 \- source\_text  
 \- status  
 \- owner  
 \- created\_at  
 \- updated\_at

 Entity: Node  
 \- id  
 \- intent\_id  
 \- type  
 \- name  
 \- description  
 \- status  
 \- metadata

 Entity: Edge  
 \- id  
 \- intent\_id  
 \- from\_node\_id  
 \- to\_node\_id  
 \- type  
 \- metadata

 Entity: SatisfactionBoundary  
 \- id  
 \- intent\_id  
 \- included\_segments  
 \- included\_surfaces  
 \- included\_journey\_steps  
 \- exclusions  
 \- completion\_rule  
 \- waiver\_policy

 Entity: AcceptanceCondition  
 \- id  
 \- intent\_id  
 \- capability\_node\_id  
 \- description  
 \- priority  
 \- classification  
 \- status

 Entity: DesignArtifact  
 \- id  
 \- source  
 \- figma\_url  
 \- figma\_file\_id  
 \- figma\_node\_id  
 \- name  
 \- surface  
 \- state  
 \- status

 Entity: WorkPackage  
 \- id  
 \- intent\_id  
 \- role  
 \- generated\_from\_conditions  
 \- content  
 \- status

## **14.11 UX requirements**

·         The default view is an intent card, not a graph hairball.  
·         Users can switch between card, chain, matrix, design coverage, and graph explorer.  
·         Generated content is always editable and never silently accepted.  
·         Missing scope or missing conditions are shown as explicit warnings.  
·         Design coverage gaps are shown as missing states/surfaces, not vague design comments.  
·         Work packages are grouped by role and tied back to specific acceptance conditions.

## **14.12 AI behavior requirements**

·         AI must produce structured graph candidates, not only prose summaries.  
·         AI must distinguish required, optional, future, and out-of-scope items when asked to generate conditions.  
·         AI must not expand scope without presenting it as a decision.  
·         AI must generate role-specific outputs from relevant subgraphs.  
·         AI must preserve traceability: every generated item should cite the node/condition that caused it.  
·         AI must ask for human review when the source text is ambiguous or when adding constraints not present in the intent.

## **14.13 Rollout plan**

| Phase | Scope | Goal |
| :---- | :---- | :---- |
| Prototype | Single-user workspace, manual graph editing, mock AI generation. | Validate mental model and UX. |
| MVP | AI parser, condition generator, manual Figma links, work package exports. | Validate usefulness for real PM workflows. |
| Pilot | Team workspace, basic permissions, integration with Jira/Linear/GitHub. | Validate team collaboration and handoff. |
| V2 | Tagged Figma sync, evidence linking, status rollups. | Validate realization tracking. |
| V3 | Code/test/evidence integrations and agentic execution. | Move from planning to realization system. |

 

# **15\. Risks and Open Questions**

## **15.1 Risks**

| Risk | Why it matters | Mitigation |
| :---- | :---- | :---- |
| Graph complexity | Users may feel overwhelmed by nodes and edges. | Default to cards, chains, and matrices. Hide full graph until needed. |
| AI over-generation | Agents may create too many conditions or tasks. | Use satisfaction boundaries and required/optional/future classifications. |
| PM adoption friction | PMs may not want another tool. | Export to existing tools and make the first intent setup very fast. |
| Figma integration complexity | Full design sync is noisy. | Start with manual links and tagged frames only. |
| False sense of verification | A linked design or generated plan may be mistaken for actual realization. | Clearly separate intent, visual intent, implementation, and evidence. |
| Terminology confusion | Intent, need, capability, condition, and story may blur. | Use a strict taxonomy and onboarding examples. |

 

## **15.2 Open questions**

·         Should the product call the core object an Intent, a Capability, or a Product Bet?  
·         How much of the graph should be visible to PMs by default?  
·         Should acceptance conditions be represented as nodes or as structured fields under capability nodes?  
·         Should evidence tracking be part of MVP or deferred to V2?  
·         How should change requests be represented: new intent versions, deltas, or both?  
·         What integrations matter most for early users: Figma, Jira/Linear, GitHub, or test management tools?  
·         How strongly should the system enforce “done” versus simply recommend missing conditions?

# **16\. Appendix: Example Data Structures**

## **16.1 Full intent object**

{  
   "intent": {  
 	"id": "intent.checkout.reuse\_saved\_address.v1",  
 	"name": "Reuse Saved Shipping Address",  
 	"version": "v1",  
 	"source\_text": "As a returning customer, I want to reuse my saved shipping address, so that I can checkout faster.",  
 	"status": "approved",  
 	"owner": "pm.gil",  
 	"satisfaction\_rule": "all\_required\_conditions\_verified\_or\_waived"  
   },  
   "scope": {  
 	"included\_segments": \["returning\_customer", "logged\_in\_user"\],  
 	"included\_surfaces": \["web\_checkout", "mobile\_checkout"\],  
 	"included\_journey\_steps": \["checkout\_shipping\_address"\],  
 	"excluded": \["guest\_user", "international\_address", "multi\_shipment"\]  
   },  
   "graph": {  
 	"nodes": \[  
   	{"id": "segment.returning\_customer", "type": "Segment", "name": "Returning Customer"},  
   	{"id": "need.faster\_checkout", "type": "Need", "name": "Faster Checkout"},  
   	{"id": "capability.reuse\_saved\_address", "type": "Capability", "name": "Reuse Saved Shipping Address"},  
   	{"id": "journey.checkout\_shipping\_address", "type": "JourneyStep", "name": "Checkout Shipping Address"},  
   	{"id": "outcome.reduced\_checkout\_friction", "type": "Outcome", "name": "Reduced Checkout Friction"},  
   	{"id": "metric.checkout\_completion\_rate", "type": "Metric", "name": "Checkout Completion Rate"}  
 	\],  
 	"edges": \[  
   	{"from": "segment.returning\_customer", "to": "need.faster\_checkout", "type": "has\_need"},  
   	{"from": "need.faster\_checkout", "to": "capability.reuse\_saved\_address", "type": "satisfied\_by"},  
   	{"from": "capability.reuse\_saved\_address", "to": "journey.checkout\_shipping\_address", "type": "expected\_at"},  
   	{"from": "capability.reuse\_saved\_address", "to": "outcome.reduced\_checkout\_friction", "type": "supports"},  
   	{"from": "outcome.reduced\_checkout\_friction", "to": "metric.checkout\_completion\_rate", "type": "measured\_by"}  
 	\]  
   },  
   "conditions": \[  
 	{"id": "condition.address\_visible", "description": "Saved address option is visible to eligible returning customers.", "classification": "required", "status": "draft"},  
 	{"id": "condition.address\_selectable", "description": "Saved address can be selected and applied to checkout.", "classification": "required", "status": "draft"},  
 	{"id": "condition.address\_editable", "description": "Selected saved address can be edited before continuing.", "classification": "required", "status": "draft"},  
 	{"id": "condition.usage\_tracked", "description": "Saved address usage is tracked with an analytics event.", "classification": "required", "status": "draft"}  
   \],  
   "design\_coverage": \[  
 	{"id": "coverage.mobile\_default", "condition\_id": "condition.address\_visible", "surface": "mobile\_checkout", "state": "default", "status": "missing"},  
 	{"id": "coverage.mobile\_selected", "condition\_id": "condition.address\_selectable", "surface": "mobile\_checkout", "state": "selected", "status": "linked"}  
   \]  
 }

## **16.2 Agent work package output shape**

{  
   "work\_package": {  
 	"id": "wp.intent.checkout.reuse\_saved\_address.v1.engineering",  
 	"role": "engineering",  
 	"intent\_id": "intent.checkout.reuse\_saved\_address.v1",  
     "generated\_from\_conditions": \[  
       "condition.address\_visible",  
       "condition.address\_selectable",  
       "condition.address\_editable",  
   	"condition.usage\_tracked"  
 	\],  
 	"sections": \[  
   	{  
     	"title": "Frontend",  
     	"items": \[  
       	"Add SavedAddressSelector to CheckoutAddressStep.",  
       	"Support empty, default, selected, loading, and error states.",  
       	"Place selector above manual address form."  
     	\]  
   	},  
   	{  
     	"title": "API / State",  
     	"items": \[  
       	"Retrieve saved addresses for authenticated users.",  
       	"Apply selected address to checkout state.",  
       	"Return recoverable validation errors."  
     	\]  
   	},  
   	{  
     	"title": "Analytics",  
     	"items": \[  
       	"Emit saved\_address\_selector\_shown.",  
       	"Emit saved\_address\_selected.",  
       	"Emit saved\_address\_fallback\_to\_manual."  
     	\]  
   	}  
 	\]  
   }  
 }

# **Closing Note**

The strongest version of this idea is not “AI writes tickets.” It is a new product operating model where product intent is structured, finite, visual, and executable. Humans define and approve meaning. Agents transform that meaning into bounded work. Evidence proves whether the meaning became real.

