import { Router, Request, Response } from "express";
import * as intentService from "../services/intentService";
import * as repo from "../repositories/graphRepository";
import { getDriver } from "../db/neo4j";
import {
  Intent,
  AcceptanceCondition,
  GraphNode,
  GraphEdge,
  WorkPackage,
} from "../types";

export const viewRouter = Router();

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

// ─── Intent List (sidebar partial) ───────────────────────────────────────────

viewRouter.get("/intents", async (req: Request, res: Response) => {
  const intents = await repo.listIntents();
  const activeId = (req.query.active as string) || "";
  res.send(renderIntentList(intents, activeId));
});

// ─── Intent Detail (main content) ────────────────────────────────────────────

viewRouter.get("/intents/:id/card", async (req: Request, res: Response) => {
  const full = await intentService.getFullIntent(paramId(req));
  if (!full) {
    res.status(404).send("<p>Intent not found</p>");
    return;
  }
  res.send(renderCard(full));
});

viewRouter.get("/intents/:id/chain", async (req: Request, res: Response) => {
  const full = await intentService.getFullIntent(paramId(req));
  if (!full) {
    res.status(404).send("<p>Intent not found</p>");
    return;
  }
  res.send(renderChain(full.nodes));
});

viewRouter.get("/intents/:id/matrix", async (req: Request, res: Response) => {
  const full = await intentService.getFullIntent(paramId(req));
  if (!full) {
    res.status(404).send("<p>Intent not found</p>");
    return;
  }
  res.send(renderMatrix(full.conditions));
});

viewRouter.get("/intents/:id/packages", async (req: Request, res: Response) => {
  const id = paramId(req);
  const packages = await repo.getWorkPackagesByIntent(id);
  res.send(renderPackages(packages, id));
});

viewRouter.post(
  "/intents/:id/packages/generate",
  async (req: Request, res: Response) => {
    const id = paramId(req);
    await intentService.generateWorkPackages(id, [
      "engineering",
      "qa",
      "design",
      "data",
    ]);
    const packages = await repo.getWorkPackagesByIntent(id);
    res.send(renderPackages(packages, id));
  },
);

viewRouter.post("/intents/:id/approve", async (req: Request, res: Response) => {
  const id = paramId(req);
  await intentService.approveIntent(id);
  const full = await intentService.getFullIntent(id);
  if (!full) {
    res.status(404).send("<p>Intent not found</p>");
    return;
  }
  res.send(renderCard(full));
});

// ─── Parse ────────────────────────────────────────────────────────────────────

viewRouter.post("/parse", async (req: Request, res: Response) => {
  const sourceText = req.body.sourceText;
  const mode = req.body.mode || "basic";
  if (!sourceText?.trim()) {
    res.send(
      `<p style="color:#f87171">Please enter a user story or PRD text.</p>`,
    );
    return;
  }
  let parsed;
  if (mode === "llm") {
    if (!process.env.OPENAI_API_KEY) {
      res.send(`<p style="color:#f87171">OPENAI_API_KEY not configured.</p>`);
      return;
    }
    const llmParser = await import("../services/llmParser");
    parsed = await llmParser.parseWithLLM(sourceText, "pm.gil");
  } else {
    parsed = await intentService.parseUserStory(sourceText, "pm.gil");
  }
  res.send(renderParsePreview(parsed));
});

viewRouter.post("/parse/save", async (req: Request, res: Response) => {
  const parsed = JSON.parse(req.body.parsedData);
  await intentService.saveIntent(parsed);
  // Return updated sidebar + success message
  const intents = await repo.listIntents();
  res.send(`
    <div id="parse-result">
      <div class="card" style="border-color:#238636">
        <p style="color:#6ee7b7">Intent saved: <strong>${parsed.intent.name}</strong></p>
      </div>
    </div>
    <div id="intent-list" hx-swap-oob="innerHTML">${renderIntentList(intents, "")}</div>
  `);
});

// ─── Query ────────────────────────────────────────────────────────────────────

viewRouter.post("/query", async (req: Request, res: Response) => {
  const cypher = req.body.cypher;
  if (!cypher?.trim()) {
    res.send(`<pre style="color:#f87171">Please enter a Cypher query.</pre>`);
    return;
  }
  const normalized = cypher.trim().toUpperCase();
  if (
    ["CREATE", "DELETE", "DETACH", "DROP", "SET", "REMOVE", "MERGE"].some((w) =>
      normalized.startsWith(w),
    )
  ) {
    res.send(
      `<pre style="color:#f87171">Only read queries (MATCH/RETURN) are allowed.</pre>`,
    );
    return;
  }
  const session = getDriver().session();
  try {
    const result = await session.run(cypher);
    const records = result.records.map((record) => {
      const obj: Record<string, unknown> = {};
      for (const key of record.keys) {
        const val = record.get(key as string);
        obj[key as string] = val?.properties ? val.properties : val;
      }
      return obj;
    });
    res.send(
      `<pre>${escapeHtml(JSON.stringify(records, null, 2))}</pre><p style="color:#6a737d;margin-top:8px">${records.length} record(s)</p>`,
    );
  } catch (err: any) {
    res.send(`<pre style="color:#f87171">${escapeHtml(err.message)}</pre>`);
  } finally {
    await session.close();
  }
});

// ─── Journeys ─────────────────────────────────────────────────────────────────

viewRouter.get("/journeys", async (_req: Request, res: Response) => {
  const intents = await repo.listIntents();
  // Gather all nodes and edges across intents
  const allNodes: GraphNode[] = [];
  const allEdges: import("../types").GraphEdge[] = [];
  const intentMap: Record<string, string> = {};
  for (const intent of intents) {
    intentMap[intent.id] = intent.name;
    const nodes = await repo.getNodesByIntent(intent.id);
    const edges = await repo.getEdgesByIntent(intent.id);
    allNodes.push(...nodes);
    allEdges.push(...edges);
  }
  res.send(renderJourneys(allNodes, allEdges, intentMap));
});

// ─── Render Helpers ───────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderIntentList(intents: Intent[], activeId: string): string {
  if (intents.length === 0)
    return `<p style="color:#6a737d">No intents yet.</p>`;
  return intents
    .map(
      (i) => `
    <li class="intent-item ${i.id === activeId ? "active" : ""}"
        hx-get="/views/intents/${i.id}/card"
        hx-target="#main-content"
        hx-push-url="false"
        hx-on::after-request="document.querySelectorAll('.intent-item').forEach(el=>el.classList.remove('active'));this.classList.add('active');document.querySelectorAll('.tab').forEach(t=>{t.classList.remove('active');if(t.dataset.tab==='card')t.classList.add('active')});window.__activeIntent='${i.id}'">
      <div class="name">${escapeHtml(i.name)}</div>
      <div class="meta">
        <span class="status-badge status-${i.status}">${i.status}</span>
        &middot; ${i.version} &middot; ${escapeHtml(i.owner)}
      </div>
    </li>
  `,
    )
    .join("");
}

function renderCard(full: any): string {
  const i = full.intent;
  const b = full.boundary;
  const nodes = full.nodes as GraphNode[];
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0">${escapeHtml(i.name)}</h2>
        ${i.status === "draft" ? `<button class="btn btn-primary" hx-post="/views/intents/${i.id}/approve" hx-target="#main-content">Approve</button>` : ""}
      </div>
      <div class="card-row"><span class="card-label">Status</span><span class="card-value"><span class="status-badge status-${i.status}">${i.status}</span></span></div>
      <div class="card-row"><span class="card-label">Segment</span><span class="card-value">${
        nodes
          .filter((n) => n.type === "Segment")
          .map((n) => escapeHtml(n.name))
          .join(", ") || "—"
      }</span></div>
      <div class="card-row"><span class="card-label">Need</span><span class="card-value">${
        nodes
          .filter((n) => n.type === "Need")
          .map((n) => escapeHtml(n.name))
          .join(", ") || "—"
      }</span></div>
      <div class="card-row"><span class="card-label">Capability</span><span class="card-value">${
        nodes
          .filter((n) => n.type === "Capability")
          .map((n) => escapeHtml(n.name))
          .join(", ") || "—"
      }</span></div>
      <div class="card-row"><span class="card-label">Outcome</span><span class="card-value">${
        nodes
          .filter((n) => n.type === "Outcome")
          .map((n) => escapeHtml(n.name))
          .join(", ") || "—"
      }</span></div>
      <div class="card-row"><span class="card-label">Metrics</span><span class="card-value">${
        nodes
          .filter((n) => n.type === "Metric")
          .map((n) => escapeHtml(n.name))
          .join(", ") || "—"
      }</span></div>
      <div class="card-row"><span class="card-label">Journey</span><span class="card-value">${
        nodes
          .filter((n) => n.type === "JourneyStep")
          .map((n) => escapeHtml(n.name))
          .join(", ") || "—"
      }</span></div>
    </div>
    ${
      b
        ? `<div class="card">
      <h3>Satisfaction Boundary</h3>
      <div class="card-row"><span class="card-label">Segments</span><span class="card-value">${(b.includedSegments || []).join(", ")}</span></div>
      <div class="card-row"><span class="card-label">Surfaces</span><span class="card-value">${(b.includedSurfaces || []).join(", ")}</span></div>
      <div class="card-row"><span class="card-label">Exclusions</span><span class="card-value">${(b.exclusions || []).join(", ") || "None"}</span></div>
      <div class="card-row"><span class="card-label">Done Rule</span><span class="card-value">${escapeHtml(b.completionRule)}</span></div>
    </div>`
        : ""
    }
    <div class="card">
      <h3>Source Text</h3>
      <p style="font-size:13px;color:#8b949e;line-height:1.5">${escapeHtml(i.sourceText)}</p>
    </div>
  `;
}

function renderChain(nodes: GraphNode[]): string {
  const order: Array<GraphNode["type"]> = [
    "Segment",
    "Need",
    "Capability",
    "JourneyStep",
    "Outcome",
    "Metric",
  ];
  let html = '<div class="chain">';
  let first = true;
  for (const type of order) {
    const group = nodes.filter((n) => n.type === type);
    if (group.length === 0) continue;
    for (const n of group) {
      if (!first) html += '<span class="chain-arrow">→</span>';
      html += `<div class="chain-node ${type}" title="${escapeHtml(n.description || n.name)}">${escapeHtml(n.name)}</div>`;
      first = false;
    }
  }
  html += "</div>";
  const extras = nodes.filter(
    (n) => n.type === "Constraint" || n.type === "Assumption",
  );
  if (extras.length) {
    html += '<div style="margin-top:16px">';
    extras.forEach((n) => {
      html += `<div class="chain-node ${n.type}" style="display:inline-block;margin:4px">${escapeHtml(n.name)}</div>`;
    });
    html += "</div>";
  }
  return html;
}

function renderMatrix(conditions: AcceptanceCondition[]): string {
  if (!conditions.length)
    return '<p style="color:#6a737d">No conditions defined.</p>';
  let html = `<table class="matrix-table">
    <thead><tr><th>#</th><th>Condition</th><th>Priority</th><th>Classification</th><th>Status</th></tr></thead><tbody>`;
  conditions.forEach((c, i) => {
    html += `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(c.description)}</td>
      <td class="priority-${c.priority}">${c.priority}</td>
      <td>${c.classification}</td>
      <td><span class="cond-status cond-${c.status}">${c.status}</span></td>
    </tr>`;
  });
  html += "</tbody></table>";
  return html;
}

function renderPackages(packages: WorkPackage[], intentId: string): string {
  if (!packages.length) {
    return `<div class="card">
      <p style="color:#6a737d;margin-bottom:12px">No work packages generated yet.</p>
      <button class="btn btn-primary" hx-post="/views/intents/${intentId}/packages/generate" hx-target="#main-content">Generate All Work Packages</button>
    </div>`;
  }
  return packages
    .map(
      (wp) => `
    <div class="card wp-section">
      <span class="wp-role wp-role-${wp.role}">${wp.role.toUpperCase()}</span>
      ${wp.sections
        .map(
          (s) => `
        <div class="wp-section-title">${escapeHtml(s.title)}</div>
        <ul class="wp-items">${s.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      `,
        )
        .join("")}
    </div>
  `,
    )
    .join("");
}

function renderParsePreview(parsed: any): string {
  const nodes = parsed.nodes as GraphNode[];
  const conditions = parsed.conditions as AcceptanceCondition[];
  const encodedData = escapeHtml(JSON.stringify(parsed));
  return `
    <div class="card" style="border-color:#388bfd">
      <h3 style="margin-bottom:12px">Parsed: ${escapeHtml(parsed.intent.name)}</h3>
      <div style="margin-bottom:8px"><strong>Nodes:</strong>
        ${nodes.map((n) => `<span class="chain-node ${n.type}" style="display:inline-block;margin:2px;padding:4px 8px;font-size:11px">${escapeHtml(n.name)}</span>`).join("")}
      </div>
      <div style="margin-bottom:8px"><strong>Conditions (${conditions.length}):</strong>
        <ul style="margin-top:4px;padding-left:16px">
          ${conditions.map((c) => `<li style="font-size:12px;margin:2px 0">[${c.priority}] ${escapeHtml(c.description)}</li>`).join("")}
        </ul>
      </div>
      <div style="margin-bottom:12px"><strong>Boundary:</strong> segments: ${parsed.suggestedBoundary.includedSegments.join(", ")} | surfaces: ${parsed.suggestedBoundary.includedSurfaces.join(", ")}</div>
      <form hx-post="/views/parse/save" hx-target="#parse-result">
        <input type="hidden" name="parsedData" value="${encodedData}">
        <button class="btn btn-primary" style="background:#238636" type="submit">Save to Graph</button>
      </form>
    </div>
  `;
}

function renderJourneys(
  allNodes: GraphNode[],
  allEdges: GraphEdge[],
  intentMap: Record<string, string>,
): string {
  // Group nodes by segment
  const segments = allNodes.filter((n) => n.type === "Segment");
  if (segments.length === 0) {
    return `<div class="empty-state">
      <div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg></div>
      <h3>No journeys yet</h3>
      <p>Parse intents with user stories to generate journey data.</p>
    </div>`;
  }

  // Build adjacency map
  const nodeById = new Map(allNodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, GraphNode[]>();
  for (const edge of allEdges) {
    const target = nodeById.get(edge.toNodeId);
    if (!target) continue;
    const list = outgoing.get(edge.fromNodeId) || [];
    list.push(target);
    outgoing.set(edge.fromNodeId, list);
  }

  // Dedupe segments by name
  const seen = new Set<string>();
  const uniqueSegments: GraphNode[] = [];
  for (const seg of segments) {
    if (!seen.has(seg.name)) {
      seen.add(seg.name);
      uniqueSegments.push(seg);
    }
  }

  let html = `<div class="journeys-header"><h2 style="font-size:16px;font-weight:600;margin-bottom:4px">User Journeys</h2><p style="color:var(--text-muted);font-size:13px;margin-bottom:24px">End-to-end flows assembled from the intent graph, grouped by user segment.</p></div>`;

  for (const segment of uniqueSegments) {
    // Find all needs for this segment (by name across intents)
    const segNodes = allNodes.filter(
      (n) => n.type === "Segment" && n.name === segment.name,
    );
    const segIds = segNodes.map((n) => n.id);

    // Traverse: Segment → Needs
    const needs = new Set<GraphNode>();
    for (const sid of segIds) {
      for (const n of outgoing.get(sid) || []) {
        if (n.type === "Need") needs.add(n);
      }
    }
    // Also find needs connected via "has_need" edges
    for (const edge of allEdges) {
      if (segIds.includes(edge.fromNodeId) && edge.type === "has_need") {
        const n = nodeById.get(edge.toNodeId);
        if (n && n.type === "Need") needs.add(n);
      }
    }

    // Traverse: Needs → Capabilities
    const capabilities = new Set<GraphNode>();
    for (const need of needs) {
      for (const n of outgoing.get(need.id) || []) {
        if (n.type === "Capability") capabilities.add(n);
      }
    }

    // Find journey steps tied to this segment's intents
    const relevantIntents = new Set(segNodes.map((n) => n.intentId));
    const journeySteps = allNodes.filter(
      (n) => n.type === "JourneyStep" && relevantIntents.has(n.intentId),
    );

    // Traverse: Capabilities/JourneySteps → Outcomes
    const outcomes = new Set<GraphNode>();
    for (const cap of capabilities) {
      for (const n of outgoing.get(cap.id) || []) {
        if (n.type === "Outcome") outcomes.add(n);
      }
    }
    for (const step of journeySteps) {
      for (const n of outgoing.get(step.id) || []) {
        if (n.type === "Outcome") outcomes.add(n);
      }
    }
    // Also grab outcomes from these intents
    allNodes
      .filter((n) => n.type === "Outcome" && relevantIntents.has(n.intentId))
      .forEach((n) => outcomes.add(n));

    // Find metrics
    const metrics = allNodes.filter(
      (n) => n.type === "Metric" && relevantIntents.has(n.intentId),
    );

    // Render journey card
    html += `<div class="card journey-card">`;
    html += `<div class="journey-segment-header">
      <span class="chain-node Segment" style="font-size:13px;padding:6px 12px">${escapeHtml(segment.name)}</span>
      <span style="color:var(--text-muted);font-size:12px;margin-left:8px">${relevantIntents.size} intent${relevantIntents.size !== 1 ? "s" : ""}</span>
    </div>`;

    // Journey flow
    html += `<div class="journey-flow">`;

    // Step 1: Needs
    if (needs.size > 0) {
      html += `<div class="journey-lane">
        <div class="journey-lane-label">Needs</div>
        <div class="journey-lane-items">
          ${[...needs].map((n) => `<div class="journey-node need">${escapeHtml(n.name)}</div>`).join("")}
        </div>
      </div>`;
      html += `<div class="journey-connector"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-4-4 4 4-4 4"/></svg></div>`;
    }

    // Step 2: Capabilities
    if (capabilities.size > 0) {
      html += `<div class="journey-lane">
        <div class="journey-lane-label">Capabilities</div>
        <div class="journey-lane-items">
          ${[...capabilities].map((n) => `<div class="journey-node capability">${escapeHtml(n.name)}</div>`).join("")}
        </div>
      </div>`;
      html += `<div class="journey-connector"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-4-4 4 4-4 4"/></svg></div>`;
    }

    // Step 3: Journey Steps
    if (journeySteps.length > 0) {
      html += `<div class="journey-lane">
        <div class="journey-lane-label">Steps</div>
        <div class="journey-lane-items">
          ${journeySteps.map((n) => `<div class="journey-node step">${escapeHtml(n.name)}</div>`).join("")}
        </div>
      </div>`;
      html += `<div class="journey-connector"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-4-4 4 4-4 4"/></svg></div>`;
    }

    // Step 4: Outcomes
    if (outcomes.size > 0) {
      html += `<div class="journey-lane">
        <div class="journey-lane-label">Outcomes</div>
        <div class="journey-lane-items">
          ${[...outcomes].map((n) => `<div class="journey-node outcome">${escapeHtml(n.name)}</div>`).join("")}
        </div>
      </div>`;
    }

    html += `</div>`; // .journey-flow

    // Metrics bar
    if (metrics.length > 0) {
      html += `<div class="journey-metrics">
        <span class="journey-lane-label" style="margin-right:8px">Metrics:</span>
        ${metrics.map((m) => `<span class="journey-metric">${escapeHtml(m.name)}</span>`).join("")}
      </div>`;
    }

    // Contributing intents
    html += `<div class="journey-intents">
      ${[...relevantIntents].map((id) => `<span class="journey-intent-tag">${escapeHtml(intentMap[id] || id)}</span>`).join("")}
    </div>`;

    html += `</div>`; // .card
  }

  return html;
}
