// ─── Node Types ───────────────────────────────────────────────────────────────

export type NodeType =
  | "Segment"
  | "Need"
  | "Capability"
  | "JourneyStep"
  | "Journey"
  | "Outcome"
  | "Metric"
  | "Constraint"
  | "Assumption"
  | "AcceptanceCondition"
  | "DesignCoverageRequirement"
  | "VisualIntentArtifact";

// ─── Edge Types ───────────────────────────────────────────────────────────────

export type EdgeType =
  | "expresses"
  | "has_need"
  | "satisfied_by"
  | "expected_at"
  | "supports"
  | "measured_by"
  | "constrained_by"
  | "assumes"
  | "requires_condition"
  | "requires_design_coverage"
  | "visually_defined_by"
  | "depends_on"
  | "part_of";

// ─── Status Models ────────────────────────────────────────────────────────────

export type IntentStatus =
  | "draft"
  | "approved"
  | "in_realization"
  | "partially_verified"
  | "verified"
  | "satisfied"
  | "superseded"
  | "deprecated";

export type ConditionClassification =
  | "required"
  | "optional"
  | "future"
  | "waived"
  | "out_of_scope";

export type ConditionStatus =
  | "draft"
  | "ready"
  | "verified"
  | "failed"
  | "waived";

export type DesignCoverageStatus =
  | "missing"
  | "linked"
  | "approved"
  | "outdated";

// ─── Core Entities ────────────────────────────────────────────────────────────

export interface Intent {
  id: string;
  name: string;
  version: string;
  sourceText: string;
  status: IntentStatus;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export interface GraphNode {
  id: string;
  intentId: string;
  type: NodeType;
  name: string;
  description?: string;
  status: string;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  intentId: string;
  fromNodeId: string;
  toNodeId: string;
  type: EdgeType;
  metadata?: Record<string, unknown>;
}

export interface SatisfactionBoundary {
  id: string;
  intentId: string;
  includedSegments: string[];
  includedSurfaces: string[];
  includedJourneySteps: string[];
  exclusions: string[];
  completionRule: string;
  waiverPolicy?: string;
}

export interface AcceptanceCondition {
  id: string;
  intentId: string;
  capabilityNodeId: string;
  description: string;
  priority: "high" | "medium" | "low";
  classification: ConditionClassification;
  status: ConditionStatus;
}

export interface DesignArtifact {
  id: string;
  intentId: string;
  conditionId?: string;
  source: string;
  figmaUrl: string;
  figmaFileId?: string;
  figmaNodeId?: string;
  name: string;
  surface: string;
  state: string;
  status: DesignCoverageStatus;
}

export interface WorkPackage {
  id: string;
  intentId: string;
  role: "engineering" | "qa" | "design" | "data";
  generatedFromConditions: string[];
  sections: WorkPackageSection[];
  status: "draft" | "approved" | "exported";
}

export interface WorkPackageSection {
  title: string;
  items: string[];
}

// ─── API Request/Response Types ───────────────────────────────────────────────

export interface CreateIntentRequest {
  sourceText: string;
  owner: string;
}

export interface ParsedIntent {
  intent: Intent;
  nodes: GraphNode[];
  edges: GraphEdge[];
  conditions: AcceptanceCondition[];
  suggestedBoundary: SatisfactionBoundary;
}

export interface UpdateConditionRequest {
  classification?: ConditionClassification;
  status?: ConditionStatus;
  priority?: "high" | "medium" | "low";
}

export interface LinkFigmaRequest {
  conditionId?: string;
  capabilityNodeId?: string;
  figmaUrl: string;
  name: string;
  surface: string;
  state: string;
}

export interface GenerateWorkPackagesRequest {
  intentId: string;
  roles: Array<"engineering" | "qa" | "design" | "data">;
}
