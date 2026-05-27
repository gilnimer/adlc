import { v4 as uuidv4 } from "uuid";
import {
  Intent,
  GraphNode,
  GraphEdge,
  AcceptanceCondition,
  SatisfactionBoundary,
  ParsedIntent,
  WorkPackage,
  DesignArtifact,
  LinkFigmaRequest,
  NodeType,
  EdgeType,
} from "../types";
import * as repo from "../repositories/graphRepository";

// ─── User Story Parsing ───────────────────────────────────────────────────────

/**
 * Parse a user story or PM statement into a structured intent graph.
 * This is a rule-based parser for MVP; can be replaced with LLM calls later.
 */
export async function parseUserStory(
  sourceText: string,
  owner: string,
): Promise<ParsedIntent> {
  const intentId = `intent.${uuidv4().slice(0, 8)}`;
  const now = new Date().toISOString();

  // Attempt to parse "As a <segment>, I want <capability>, so that <outcome>"
  const parsed = extractStoryParts(sourceText);

  const intent: Intent = {
    id: intentId,
    name: parsed.capability || "Untitled Intent",
    version: "v1",
    sourceText,
    status: "draft",
    owner,
    createdAt: now,
    updatedAt: now,
  };

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Segment node
  const segmentId = makeNodeId("segment", parsed.segment);
  nodes.push({
    id: segmentId,
    intentId,
    type: "Segment",
    name: parsed.segment || "User",
    status: "draft",
  });

  // Need node (derived from capability — what the user needs to do)
  const needId = makeNodeId("need", parsed.capability);
  nodes.push({
    id: needId,
    intentId,
    type: "Need",
    name: parsed.capability
      ? `Need to ${parsed.capability}`
      : "Unspecified Need",
    status: "draft",
  });

  // Capability node
  const capabilityId = makeNodeId("capability", parsed.capability);
  nodes.push({
    id: capabilityId,
    intentId,
    type: "Capability",
    name: parsed.capability || "Unspecified Capability",
    description: sourceText,
    status: "draft",
  });

  // Outcome node
  const outcomeId = makeNodeId("outcome", parsed.outcome);
  nodes.push({
    id: outcomeId,
    intentId,
    type: "Outcome",
    name: parsed.outcome || "Unspecified Outcome",
    status: "draft",
  });

  // Edges
  edges.push(makeEdge(intentId, segmentId, needId, "has_need"));
  edges.push(makeEdge(intentId, needId, capabilityId, "satisfied_by"));
  edges.push(makeEdge(intentId, capabilityId, outcomeId, "supports"));

  // Generate acceptance conditions from the capability
  const conditions = generateConditions(
    intentId,
    capabilityId,
    parsed.capability,
  );

  // Suggested satisfaction boundary
  const suggestedBoundary: SatisfactionBoundary = {
    id: `boundary.${intentId}`,
    intentId,
    includedSegments: [parsed.segment || "all_users"],
    includedSurfaces: ["web", "mobile"],
    includedJourneySteps: [],
    exclusions: [],
    completionRule: "all_required_conditions_verified_or_waived",
  };

  return { intent, nodes, edges, conditions, suggestedBoundary };
}

/**
 * Save a parsed intent (after user review/approval) to the graph store.
 */
export async function saveIntent(parsed: ParsedIntent): Promise<Intent> {
  await repo.createIntent(parsed.intent);
  await repo.createGraphNodes(parsed.nodes);
  await repo.createGraphEdges(parsed.edges);
  await repo.createConditions(parsed.conditions);
  await repo.createBoundary(parsed.suggestedBoundary);
  return parsed.intent;
}

// ─── Approval ─────────────────────────────────────────────────────────────────

export async function approveIntent(intentId: string): Promise<void> {
  await repo.updateIntentStatus(intentId, "approved");
}

// ─── Full Intent Retrieval ────────────────────────────────────────────────────

export async function getFullIntent(intentId: string) {
  const intent = await repo.getIntent(intentId);
  if (!intent) return null;

  const [nodes, edges, conditions, boundary, designArtifacts, workPackages] =
    await Promise.all([
      repo.getNodesByIntent(intentId),
      repo.getEdgesByIntent(intentId),
      repo.getConditionsByIntent(intentId),
      repo.getBoundaryByIntent(intentId),
      repo.getDesignArtifactsByIntent(intentId),
      repo.getWorkPackagesByIntent(intentId),
    ]);

  return {
    intent,
    nodes,
    edges,
    conditions,
    boundary,
    designArtifacts,
    workPackages,
  };
}

// ─── Figma Linking ────────────────────────────────────────────────────────────

export async function linkFigma(
  intentId: string,
  req: LinkFigmaRequest,
): Promise<DesignArtifact> {
  const artifact: DesignArtifact = {
    id: `design.${uuidv4().slice(0, 8)}`,
    intentId,
    conditionId: req.conditionId,
    source: "figma",
    figmaUrl: req.figmaUrl,
    figmaFileId: extractFigmaFileId(req.figmaUrl),
    figmaNodeId: extractFigmaNodeId(req.figmaUrl),
    name: req.name,
    surface: req.surface,
    state: req.state,
    status: "linked",
  };
  return repo.createDesignArtifact(artifact);
}

// ─── Work Package Generation ──────────────────────────────────────────────────

export async function generateWorkPackages(
  intentId: string,
  roles: Array<"engineering" | "qa" | "design" | "data">,
): Promise<WorkPackage[]> {
  const conditions = await repo.getConditionsByIntent(intentId);
  const nodes = await repo.getNodesByIntent(intentId);
  const capability = nodes.find((n) => n.type === "Capability");

  const requiredConditions = conditions.filter(
    (c) => c.classification === "required",
  );
  const conditionIds = requiredConditions.map((c) => c.id);
  const conditionDescs = requiredConditions.map((c) => c.description);

  const packages: WorkPackage[] = [];

  for (const role of roles) {
    const wp: WorkPackage = {
      id: `wp.${intentId}.${role}`,
      intentId,
      role,
      generatedFromConditions: conditionIds,
      sections: generateSectionsForRole(
        role,
        capability?.name || "",
        conditionDescs,
      ),
      status: "draft",
    };
    await repo.createWorkPackage(wp);
    packages.push(wp);
  }

  return packages;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractStoryParts(text: string): {
  segment: string;
  capability: string;
  outcome: string;
} {
  // Match "As a <X>, I want <Y>, so that <Z>"
  const match = text.match(
    /[Aa]s\s+(?:a|an)\s+(.+?),\s*[Ii]\s*want\s+(?:to\s+)?(.+?),\s*so\s+that\s+(.+)/,
  );
  if (match) {
    return {
      segment: match[1].trim(),
      capability: match[2].trim(),
      outcome: match[3].trim(),
    };
  }
  // Fallback: treat entire text as capability
  return {
    segment: "User",
    capability: text.slice(0, 100),
    outcome: "improved experience",
  };
}

function makeNodeId(type: string, name: string): string {
  const slug = (name || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 40);
  return `${type}.${slug}`;
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

function generateConditions(
  intentId: string,
  capabilityId: string,
  capabilityName: string,
): AcceptanceCondition[] {
  // Rule-based condition generation for MVP
  const baseConditions = [
    `${capabilityName} is visible to eligible users`,
    `${capabilityName} can be activated/selected by the user`,
    `${capabilityName} completes successfully`,
    `${capabilityName} usage is tracked with analytics`,
  ];

  return baseConditions.map((desc, i) => ({
    id: `condition.${intentId}.${i + 1}`,
    intentId,
    capabilityNodeId: capabilityId,
    description: desc,
    priority: i < 2 ? ("high" as const) : ("medium" as const),
    classification: "required" as const,
    status: "draft" as const,
  }));
}

function generateSectionsForRole(
  role: "engineering" | "qa" | "design" | "data",
  capabilityName: string,
  conditions: string[],
) {
  switch (role) {
    case "engineering":
      return [
        {
          title: "Frontend",
          items: [
            `Implement UI for: ${capabilityName}`,
            ...conditions.map((c) => `Ensure: ${c}`),
          ],
        },
        {
          title: "Backend / API",
          items: [
            `Create or extend API endpoints to support ${capabilityName}`,
            `Add validation and error handling`,
          ],
        },
      ];
    case "qa":
      return [
        {
          title: "Test Scenarios",
          items: conditions.map((c) => `Verify: ${c}`),
        },
        {
          title: "Edge Cases",
          items: [
            `Test with missing/invalid data`,
            `Test across included surfaces`,
            `Test with boundary segment users`,
          ],
        },
      ];
    case "design":
      return [
        {
          title: "Required States",
          items: [
            `Default state for ${capabilityName}`,
            `Active/selected state`,
            `Empty state`,
            `Error/recovery state`,
            `Loading state`,
          ],
        },
        {
          title: "Surfaces",
          items: [`Desktop layout`, `Mobile layout`],
        },
      ];
    case "data":
      return [
        {
          title: "Tracking Plan",
          items: [
            `Event: ${capabilityName.toLowerCase().replace(/\s+/g, "_")}_shown`,
            `Event: ${capabilityName.toLowerCase().replace(/\s+/g, "_")}_activated`,
            `Event: ${capabilityName.toLowerCase().replace(/\s+/g, "_")}_completed`,
          ],
        },
        {
          title: "Metrics",
          items: conditions.map((c) => `Measure: ${c}`),
        },
      ];
  }
}

function extractFigmaFileId(url: string): string {
  const match = url.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : "";
}

function extractFigmaNodeId(url: string): string {
  const match = url.match(/node-id=([^&]+)/);
  return match ? match[1].replace(/-/g, ":") : "";
}
