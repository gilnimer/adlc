import { Router, Request, Response } from "express";
import * as intentService from "../services/intentService";
import * as llmParser from "../services/llmParser";
import * as repo from "../repositories/graphRepository";
import { getDriver } from "../db/neo4j";
import {
  CreateIntentRequest,
  GenerateWorkPackagesRequest,
  LinkFigmaRequest,
  UpdateConditionRequest,
} from "../types";

export const router = Router();

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

// ─── Parse a user story (preview, does not save) ──────────────────────────────

router.post("/intents/parse", async (req: Request, res: Response) => {
  const { sourceText, owner } = req.body as CreateIntentRequest;
  if (!sourceText) {
    res.status(400).json({ error: "sourceText is required" });
    return;
  }
  const parsed = await intentService.parseUserStory(
    sourceText,
    owner || "anonymous",
  );
  res.json(parsed);
});

// ─── Save a parsed intent (after user review) ─────────────────────────────────

router.post("/intents", async (req: Request, res: Response) => {
  const parsed = req.body;
  if (!parsed?.intent?.id) {
    res.status(400).json({ error: "A parsed intent object is required" });
    return;
  }
  const intent = await intentService.saveIntent(parsed);
  res.status(201).json(intent);
});

// ─── List all intents ─────────────────────────────────────────────────────────

router.get("/intents", async (_req: Request, res: Response) => {
  const intents = await repo.listIntents();
  res.json(intents);
});

// ─── Get full intent with graph, conditions, boundary ─────────────────────────

router.get("/intents/:id", async (req: Request, res: Response) => {
  const full = await intentService.getFullIntent(paramId(req));
  if (!full) {
    res.status(404).json({ error: "Intent not found" });
    return;
  }
  res.json(full);
});

// ─── Approve an intent ────────────────────────────────────────────────────────

router.post("/intents/:id/approve", async (req: Request, res: Response) => {
  await intentService.approveIntent(paramId(req));
  res.json({ status: "approved" });
});

// ─── Update a condition ───────────────────────────────────────────────────────

router.patch("/conditions/:id", async (req: Request, res: Response) => {
  const updates = req.body as UpdateConditionRequest;
  await repo.updateCondition(paramId(req), updates);
  res.json({ status: "updated" });
});

// ─── Link Figma artifact ──────────────────────────────────────────────────────

router.post("/intents/:id/figma", async (req: Request, res: Response) => {
  const linkReq = req.body as LinkFigmaRequest;
  if (!linkReq.figmaUrl) {
    res.status(400).json({ error: "figmaUrl is required" });
    return;
  }
  const artifact = await intentService.linkFigma(paramId(req), linkReq);
  res.status(201).json(artifact);
});

// ─── Get design artifacts for an intent ───────────────────────────────────────

router.get("/intents/:id/figma", async (req: Request, res: Response) => {
  const artifacts = await repo.getDesignArtifactsByIntent(paramId(req));
  res.json(artifacts);
});

// ─── Generate work packages ───────────────────────────────────────────────────

router.post(
  "/intents/:id/work-packages",
  async (req: Request, res: Response) => {
    const { roles } = req.body as GenerateWorkPackagesRequest;
    if (!roles || roles.length === 0) {
      res.status(400).json({ error: "roles array is required" });
      return;
    }
    const packages = await intentService.generateWorkPackages(
      paramId(req),
      roles,
    );
    res.status(201).json(packages);
  },
);

// ─── Get work packages for an intent ──────────────────────────────────────────

router.get(
  "/intents/:id/work-packages",
  async (req: Request, res: Response) => {
    const packages = await repo.getWorkPackagesByIntent(paramId(req));
    res.json(packages);
  },
);

// ─── LLM-powered parse (richer decomposition) ────────────────────────────────

router.post("/intents/parse-llm", async (req: Request, res: Response) => {
  const { sourceText, owner } = req.body as CreateIntentRequest;
  if (!sourceText) {
    res.status(400).json({ error: "sourceText is required" });
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ error: "OPENAI_API_KEY not configured" });
    return;
  }
  const parsed = await llmParser.parseWithLLM(sourceText, owner || "anonymous");
  res.json(parsed);
});

// ─── Cypher query endpoint ────────────────────────────────────────────────────

router.post("/query", async (req: Request, res: Response) => {
  const { cypher, params } = req.body as {
    cypher: string;
    params?: Record<string, unknown>;
  };
  if (!cypher) {
    res.status(400).json({ error: "cypher query is required" });
    return;
  }
  // Only allow read queries
  const normalized = cypher.trim().toUpperCase();
  if (
    normalized.startsWith("CREATE") ||
    normalized.startsWith("DELETE") ||
    normalized.startsWith("DETACH") ||
    normalized.startsWith("DROP") ||
    normalized.startsWith("SET") ||
    normalized.startsWith("REMOVE") ||
    normalized.startsWith("MERGE")
  ) {
    res
      .status(403)
      .json({ error: "Only read queries (MATCH/RETURN) are allowed" });
    return;
  }
  const session = getDriver().session();
  try {
    const result = await session.run(cypher, params || {});
    const records = result.records.map((record) => {
      const obj: Record<string, unknown> = {};
      for (const key of record.keys) {
        const val = record.get(key as string);
        obj[key as string] = val?.properties ? val.properties : val;
      }
      return obj;
    });
    res.json({ records, count: records.length });
  } finally {
    await session.close();
  }
});
