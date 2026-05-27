import { getDriver } from "../db/neo4j";
import {
  Intent,
  GraphNode,
  GraphEdge,
  AcceptanceCondition,
  SatisfactionBoundary,
  DesignArtifact,
  WorkPackage,
} from "../types";

// ─── Intent ───────────────────────────────────────────────────────────────────

export async function createIntent(intent: Intent): Promise<Intent> {
  const session = getDriver().session();
  try {
    await session.run(
      `CREATE (i:Intent {
        id: $id, name: $name, version: $version,
        sourceText: $sourceText, status: $status,
        owner: $owner, createdAt: $createdAt, updatedAt: $updatedAt
      })`,
      intent,
    );
    return intent;
  } finally {
    await session.close();
  }
}

export async function getIntent(id: string): Promise<Intent | null> {
  const session = getDriver().session();
  try {
    const result = await session.run(`MATCH (i:Intent {id: $id}) RETURN i`, {
      id,
    });
    if (result.records.length === 0) return null;
    return result.records[0].get("i").properties as Intent;
  } finally {
    await session.close();
  }
}

export async function listIntents(): Promise<Intent[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (i:Intent) RETURN i ORDER BY i.createdAt DESC`,
    );
    return result.records.map((r) => r.get("i").properties as Intent);
  } finally {
    await session.close();
  }
}

export async function updateIntentStatus(
  id: string,
  status: string,
): Promise<void> {
  const session = getDriver().session();
  try {
    await session.run(
      `MATCH (i:Intent {id: $id}) SET i.status = $status, i.updatedAt = $now`,
      { id, status, now: new Date().toISOString() },
    );
  } finally {
    await session.close();
  }
}

// ─── Graph Nodes ──────────────────────────────────────────────────────────────

export async function createGraphNode(node: GraphNode): Promise<GraphNode> {
  const session = getDriver().session();
  try {
    await session.run(
      `CREATE (n:GraphNode {
        id: $id, intentId: $intentId, type: $type,
        name: $name, description: $description,
        status: $status, metadata: $metadata
      })`,
      {
        ...node,
        description: node.description || "",
        metadata: JSON.stringify(node.metadata || {}),
      },
    );
    // Link node to its intent
    await session.run(
      `MATCH (i:Intent {id: $intentId}), (n:GraphNode {id: $nodeId})
       CREATE (i)-[:CONTAINS]->(n)`,
      { intentId: node.intentId, nodeId: node.id },
    );
    return node;
  } finally {
    await session.close();
  }
}

export async function createGraphNodes(nodes: GraphNode[]): Promise<void> {
  const session = getDriver().session();
  try {
    await session.run(
      `UNWIND $nodes AS node
       MERGE (n:GraphNode {id: node.id})
       ON CREATE SET n.intentId = node.intentId, n.type = node.type,
         n.name = node.name, n.description = node.description,
         n.status = node.status, n.metadata = node.metadata`,
      {
        nodes: nodes.map((n) => ({
          ...n,
          description: n.description || "",
          metadata: JSON.stringify(n.metadata || {}),
        })),
      },
    );
    // Link all to intent
    if (nodes.length > 0) {
      await session.run(
        `UNWIND $nodes AS node
         MATCH (i:Intent {id: node.intentId}), (n:GraphNode {id: node.id})
         MERGE (i)-[:CONTAINS]->(n)`,
        { nodes },
      );
    }
  } finally {
    await session.close();
  }
}

export async function getNodesByIntent(intentId: string): Promise<GraphNode[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (n:GraphNode {intentId: $intentId}) RETURN n`,
      { intentId },
    );
    return result.records.map((r) => {
      const props = r.get("n").properties;
      return {
        ...props,
        metadata: props.metadata ? JSON.parse(props.metadata) : {},
      } as GraphNode;
    });
  } finally {
    await session.close();
  }
}

// ─── Graph Edges ──────────────────────────────────────────────────────────────

export async function createGraphEdge(edge: GraphEdge): Promise<GraphEdge> {
  const session = getDriver().session();
  try {
    // Store edge as a relationship between GraphNodes
    await session.run(
      `MATCH (from:GraphNode {id: $fromNodeId}), (to:GraphNode {id: $toNodeId})
       CREATE (from)-[r:GRAPH_EDGE {
         id: $id, intentId: $intentId, type: $type, metadata: $metadata
       }]->(to)`,
      {
        ...edge,
        metadata: JSON.stringify(edge.metadata || {}),
      },
    );
    return edge;
  } finally {
    await session.close();
  }
}

export async function createGraphEdges(edges: GraphEdge[]): Promise<void> {
  const session = getDriver().session();
  try {
    await session.run(
      `UNWIND $edges AS edge
       MATCH (from:GraphNode {id: edge.fromNodeId}), (to:GraphNode {id: edge.toNodeId})
       MERGE (from)-[r:GRAPH_EDGE {id: edge.id}]->(to)
       ON CREATE SET r.intentId = edge.intentId, r.type = edge.type, r.metadata = edge.metadata`,
      {
        edges: edges.map((e) => ({
          ...e,
          metadata: JSON.stringify(e.metadata || {}),
        })),
      },
    );
  } finally {
    await session.close();
  }
}

export async function getEdgesByIntent(intentId: string): Promise<GraphEdge[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (from:GraphNode)-[r:GRAPH_EDGE {intentId: $intentId}]->(to:GraphNode)
       RETURN r, from.id AS fromId, to.id AS toId`,
      { intentId },
    );
    return result.records.map((r) => {
      const props = r.get("r").properties;
      return {
        ...props,
        fromNodeId: r.get("fromId"),
        toNodeId: r.get("toId"),
        metadata: props.metadata ? JSON.parse(props.metadata) : {},
      } as GraphEdge;
    });
  } finally {
    await session.close();
  }
}

// ─── Acceptance Conditions ────────────────────────────────────────────────────

export async function createCondition(
  condition: AcceptanceCondition,
): Promise<AcceptanceCondition> {
  const session = getDriver().session();
  try {
    await session.run(
      `CREATE (c:AcceptanceCondition {
        id: $id, intentId: $intentId, capabilityNodeId: $capabilityNodeId,
        description: $description, priority: $priority,
        classification: $classification, status: $status
      })`,
      condition,
    );
    // Link to intent and capability
    await session.run(
      `MATCH (i:Intent {id: $intentId}), (c:AcceptanceCondition {id: $condId})
       CREATE (i)-[:HAS_CONDITION]->(c)`,
      { intentId: condition.intentId, condId: condition.id },
    );
    await session.run(
      `MATCH (n:GraphNode {id: $capId}), (c:AcceptanceCondition {id: $condId})
       CREATE (n)-[:REQUIRES_CONDITION]->(c)`,
      { capId: condition.capabilityNodeId, condId: condition.id },
    );
    return condition;
  } finally {
    await session.close();
  }
}

export async function createConditions(
  conditions: AcceptanceCondition[],
): Promise<void> {
  const session = getDriver().session();
  try {
    await session.run(
      `UNWIND $conditions AS cond
       CREATE (c:AcceptanceCondition {
         id: cond.id, intentId: cond.intentId, capabilityNodeId: cond.capabilityNodeId,
         description: cond.description, priority: cond.priority,
         classification: cond.classification, status: cond.status
       })`,
      { conditions },
    );
    await session.run(
      `UNWIND $conditions AS cond
       MATCH (i:Intent {id: cond.intentId}), (c:AcceptanceCondition {id: cond.id})
       CREATE (i)-[:HAS_CONDITION]->(c)`,
      { conditions },
    );
    await session.run(
      `UNWIND $conditions AS cond
       MATCH (n:GraphNode {id: cond.capabilityNodeId}), (c:AcceptanceCondition {id: cond.id})
       CREATE (n)-[:REQUIRES_CONDITION]->(c)`,
      { conditions },
    );
  } finally {
    await session.close();
  }
}

export async function getConditionsByIntent(
  intentId: string,
): Promise<AcceptanceCondition[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (c:AcceptanceCondition {intentId: $intentId}) RETURN c`,
      { intentId },
    );
    return result.records.map(
      (r) => r.get("c").properties as AcceptanceCondition,
    );
  } finally {
    await session.close();
  }
}

export async function updateCondition(
  id: string,
  updates: Partial<
    Pick<AcceptanceCondition, "classification" | "status" | "priority">
  >,
): Promise<void> {
  const session = getDriver().session();
  try {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };
    if (updates.classification) {
      setClauses.push("c.classification = $classification");
      params.classification = updates.classification;
    }
    if (updates.status) {
      setClauses.push("c.status = $status");
      params.status = updates.status;
    }
    if (updates.priority) {
      setClauses.push("c.priority = $priority");
      params.priority = updates.priority;
    }
    if (setClauses.length > 0) {
      await session.run(
        `MATCH (c:AcceptanceCondition {id: $id}) SET ${setClauses.join(", ")}`,
        params,
      );
    }
  } finally {
    await session.close();
  }
}

// ─── Satisfaction Boundary ────────────────────────────────────────────────────

export async function createBoundary(
  boundary: SatisfactionBoundary,
): Promise<SatisfactionBoundary> {
  const session = getDriver().session();
  try {
    await session.run(
      `CREATE (b:SatisfactionBoundary {
        id: $id, intentId: $intentId,
        includedSegments: $includedSegments,
        includedSurfaces: $includedSurfaces,
        includedJourneySteps: $includedJourneySteps,
        exclusions: $exclusions,
        completionRule: $completionRule,
        waiverPolicy: $waiverPolicy
      })`,
      {
        ...boundary,
        waiverPolicy: boundary.waiverPolicy || "",
      },
    );
    await session.run(
      `MATCH (i:Intent {id: $intentId}), (b:SatisfactionBoundary {id: $bId})
       CREATE (i)-[:HAS_BOUNDARY]->(b)`,
      { intentId: boundary.intentId, bId: boundary.id },
    );
    return boundary;
  } finally {
    await session.close();
  }
}

export async function getBoundaryByIntent(
  intentId: string,
): Promise<SatisfactionBoundary | null> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (b:SatisfactionBoundary {intentId: $intentId}) RETURN b`,
      { intentId },
    );
    if (result.records.length === 0) return null;
    return result.records[0].get("b").properties as SatisfactionBoundary;
  } finally {
    await session.close();
  }
}

// ─── Design Artifacts ─────────────────────────────────────────────────────────

export async function createDesignArtifact(
  artifact: DesignArtifact,
): Promise<DesignArtifact> {
  const session = getDriver().session();
  try {
    await session.run(
      `CREATE (d:DesignArtifact {
        id: $id, intentId: $intentId, conditionId: $conditionId,
        source: $source, figmaUrl: $figmaUrl,
        figmaFileId: $figmaFileId, figmaNodeId: $figmaNodeId,
        name: $name, surface: $surface, state: $state, status: $status
      })`,
      {
        ...artifact,
        conditionId: artifact.conditionId || "",
        figmaFileId: artifact.figmaFileId || "",
        figmaNodeId: artifact.figmaNodeId || "",
      },
    );
    if (artifact.conditionId) {
      await session.run(
        `MATCH (c:AcceptanceCondition {id: $condId}), (d:DesignArtifact {id: $dId})
         CREATE (c)-[:HAS_DESIGN]->(d)`,
        { condId: artifact.conditionId, dId: artifact.id },
      );
    }
    return artifact;
  } finally {
    await session.close();
  }
}

export async function getDesignArtifactsByIntent(
  intentId: string,
): Promise<DesignArtifact[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (d:DesignArtifact {intentId: $intentId}) RETURN d`,
      { intentId },
    );
    return result.records.map((r) => r.get("d").properties as DesignArtifact);
  } finally {
    await session.close();
  }
}

// ─── Work Packages ────────────────────────────────────────────────────────────

export async function createWorkPackage(wp: WorkPackage): Promise<WorkPackage> {
  const session = getDriver().session();
  try {
    await session.run(
      `CREATE (w:WorkPackage {
        id: $id, intentId: $intentId, role: $role,
        generatedFromConditions: $generatedFromConditions,
        sections: $sections, status: $status
      })`,
      {
        ...wp,
        sections: JSON.stringify(wp.sections),
      },
    );
    await session.run(
      `MATCH (i:Intent {id: $intentId}), (w:WorkPackage {id: $wId})
       CREATE (i)-[:HAS_WORK_PACKAGE]->(w)`,
      { intentId: wp.intentId, wId: wp.id },
    );
    return wp;
  } finally {
    await session.close();
  }
}

export async function getWorkPackagesByIntent(
  intentId: string,
): Promise<WorkPackage[]> {
  const session = getDriver().session();
  try {
    const result = await session.run(
      `MATCH (w:WorkPackage {intentId: $intentId}) RETURN w`,
      { intentId },
    );
    return result.records.map((r) => {
      const props = r.get("w").properties;
      return {
        ...props,
        sections: JSON.parse(props.sections),
      } as WorkPackage;
    });
  } finally {
    await session.close();
  }
}
