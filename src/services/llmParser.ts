import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import {
  Intent,
  GraphNode,
  GraphEdge,
  AcceptanceCondition,
  SatisfactionBoundary,
  ParsedIntent,
  EdgeType,
} from "../types";

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const SYSTEM_PROMPT = `You are a Product Intent Graph parser. You take user stories, PRD excerpts, or PM statements and decompose them into a structured intent graph.

You MUST return valid JSON matching this exact schema:

{
  "name": "short capability name (3-8 words)",
  "segments": [{"name": "segment name", "description": "who this is"}],
  "needs": [{"name": "user need", "description": "the problem or desire"}],
  "capabilities": [{"name": "capability name", "description": "what the product enables"}],
  "journeySteps": [{"name": "step name", "description": "where in the user journey"}],
  "outcomes": [{"name": "outcome name", "description": "expected result"}],
  "metrics": [{"name": "metric name", "description": "how to measure success"}],
  "constraints": [{"name": "constraint", "description": "hard rules or boundaries"}],
  "assumptions": [{"name": "assumption", "description": "beliefs that may need validation"}],
  "conditions": [{"description": "acceptance condition statement", "priority": "high|medium|low"}],
  "boundary": {
    "includedSegments": ["segment names"],
    "includedSurfaces": ["web", "mobile", "api", etc.],
    "includedJourneySteps": ["step names"],
    "exclusions": ["what is out of scope"]
  },
  "edges": [{"from": "type.name_slug", "to": "type.name_slug", "type": "edge_type"}]
}

Edge types: has_need, satisfied_by, expected_at, supports, measured_by, constrained_by, assumes, requires_condition, depends_on, part_of

Rules:
- Generate 4-8 meaningful acceptance conditions, not generic ones
- Conditions should be specific, testable, and finite
- Include at least one metric
- Include constraints if any are implied
- Mark conditions as high priority if they represent core functionality
- Be specific to the domain, not generic boilerplate`;

interface LLMParsedOutput {
  name: string;
  segments: Array<{ name: string; description: string }>;
  needs: Array<{ name: string; description: string }>;
  capabilities: Array<{ name: string; description: string }>;
  journeySteps: Array<{ name: string; description: string }>;
  outcomes: Array<{ name: string; description: string }>;
  metrics: Array<{ name: string; description: string }>;
  constraints: Array<{ name: string; description: string }>;
  assumptions: Array<{ name: string; description: string }>;
  conditions: Array<{
    description: string;
    priority: "high" | "medium" | "low";
  }>;
  boundary: {
    includedSegments: string[];
    includedSurfaces: string[];
    includedJourneySteps: string[];
    exclusions: string[];
  };
  edges: Array<{ from: string; to: string; type: string }>;
}

/**
 * Parse a user story or PRD text using an LLM for richer intent decomposition.
 */
export async function parseWithLLM(
  sourceText: string,
  owner: string,
): Promise<ParsedIntent> {
  const intentId = `intent.${uuidv4().slice(0, 8)}`;
  const now = new Date().toISOString();

  const completion = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Parse this into a product intent graph:\n\n${sourceText}`,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("LLM returned empty response");

  const parsed: LLMParsedOutput = JSON.parse(raw);

  // Build nodes
  const nodes: GraphNode[] = [];
  const nodeMap = new Map<string, string>(); // slug -> id

  for (const seg of parsed.segments) {
    const id = makeNodeId("segment", seg.name);
    nodeMap.set(`segment.${slug(seg.name)}`, id);
    nodes.push({
      id,
      intentId,
      type: "Segment",
      name: seg.name,
      description: seg.description,
      status: "draft",
    });
  }
  for (const need of parsed.needs) {
    const id = makeNodeId("need", need.name);
    nodeMap.set(`need.${slug(need.name)}`, id);
    nodes.push({
      id,
      intentId,
      type: "Need",
      name: need.name,
      description: need.description,
      status: "draft",
    });
  }
  for (const cap of parsed.capabilities) {
    const id = makeNodeId("capability", cap.name);
    nodeMap.set(`capability.${slug(cap.name)}`, id);
    nodes.push({
      id,
      intentId,
      type: "Capability",
      name: cap.name,
      description: cap.description,
      status: "draft",
    });
  }
  for (const step of parsed.journeySteps) {
    const id = makeNodeId("journey_step", step.name);
    nodeMap.set(`journey_step.${slug(step.name)}`, id);
    nodes.push({
      id,
      intentId,
      type: "JourneyStep",
      name: step.name,
      description: step.description,
      status: "draft",
    });
  }
  for (const out of parsed.outcomes) {
    const id = makeNodeId("outcome", out.name);
    nodeMap.set(`outcome.${slug(out.name)}`, id);
    nodes.push({
      id,
      intentId,
      type: "Outcome",
      name: out.name,
      description: out.description,
      status: "draft",
    });
  }
  for (const met of parsed.metrics) {
    const id = makeNodeId("metric", met.name);
    nodeMap.set(`metric.${slug(met.name)}`, id);
    nodes.push({
      id,
      intentId,
      type: "Metric",
      name: met.name,
      description: met.description,
      status: "draft",
    });
  }
  for (const con of parsed.constraints) {
    const id = makeNodeId("constraint", con.name);
    nodeMap.set(`constraint.${slug(con.name)}`, id);
    nodes.push({
      id,
      intentId,
      type: "Constraint",
      name: con.name,
      description: con.description,
      status: "draft",
    });
  }
  for (const asm of parsed.assumptions) {
    const id = makeNodeId("assumption", asm.name);
    nodeMap.set(`assumption.${slug(asm.name)}`, id);
    nodes.push({
      id,
      intentId,
      type: "Assumption",
      name: asm.name,
      description: asm.description,
      status: "draft",
    });
  }

  // Build edges from LLM output + auto-generate standard ones
  const edges: GraphEdge[] = [];
  const allNodeIds = nodes.map((n) => n.id);

  // Auto-wire: segment -> need -> capability -> outcome -> metric
  const segIds = nodes.filter((n) => n.type === "Segment").map((n) => n.id);
  const needIds = nodes.filter((n) => n.type === "Need").map((n) => n.id);
  const capIds = nodes.filter((n) => n.type === "Capability").map((n) => n.id);
  const outcomeIds = nodes.filter((n) => n.type === "Outcome").map((n) => n.id);
  const metricIds = nodes.filter((n) => n.type === "Metric").map((n) => n.id);
  const stepIds = nodes
    .filter((n) => n.type === "JourneyStep")
    .map((n) => n.id);

  // segment -> needs
  for (const s of segIds) {
    for (const n of needIds) {
      edges.push(makeEdge(intentId, s, n, "has_need"));
    }
  }
  // needs -> capabilities
  for (const n of needIds) {
    for (const c of capIds) {
      edges.push(makeEdge(intentId, n, c, "satisfied_by"));
    }
  }
  // capabilities -> outcomes
  for (const c of capIds) {
    for (const o of outcomeIds) {
      edges.push(makeEdge(intentId, c, o, "supports"));
    }
  }
  // capabilities -> journey steps
  for (const c of capIds) {
    for (const s of stepIds) {
      edges.push(makeEdge(intentId, c, s, "expected_at"));
    }
  }
  // outcomes -> metrics
  for (const o of outcomeIds) {
    for (const m of metricIds) {
      edges.push(makeEdge(intentId, o, m, "measured_by"));
    }
  }

  // Build conditions
  const primaryCapId = capIds[0] || "";
  const conditions: AcceptanceCondition[] = parsed.conditions.map((c, i) => ({
    id: `condition.${intentId}.${i + 1}`,
    intentId,
    capabilityNodeId: primaryCapId,
    description: c.description,
    priority: c.priority,
    classification: "required" as const,
    status: "draft" as const,
  }));

  // Intent object
  const intent: Intent = {
    id: intentId,
    name:
      parsed.name ||
      nodes.find((n) => n.type === "Capability")?.name ||
      "Untitled",
    version: "v1",
    sourceText,
    status: "draft",
    owner,
    createdAt: now,
    updatedAt: now,
  };

  // Boundary
  const suggestedBoundary: SatisfactionBoundary = {
    id: `boundary.${intentId}`,
    intentId,
    includedSegments: parsed.boundary.includedSegments,
    includedSurfaces: parsed.boundary.includedSurfaces,
    includedJourneySteps: parsed.boundary.includedJourneySteps,
    exclusions: parsed.boundary.exclusions,
    completionRule: "all_required_conditions_verified_or_waived",
  };

  return { intent, nodes, edges, conditions, suggestedBoundary };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 40);
}

function makeNodeId(type: string, name: string): string {
  return `${type}.${slug(name)}`;
}

function makeEdge(
  intentId: string,
  from: string,
  to: string,
  type: EdgeType,
): GraphEdge {
  return {
    id: `edge.${uuidv4().slice(0, 8)}`,
    intentId,
    fromNodeId: from,
    toNodeId: to,
    type,
  };
}
