import "dotenv/config";
import express from "express";
import path from "path";
import { initSchema, closeDriver } from "./db/neo4j";
import { router } from "./api/routes";
import { viewRouter } from "./api/views";

const PORT = process.env.PORT || 3000;

async function main() {
  // Initialize Neo4j schema
  await initSchema();

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static frontend
  app.use(express.static(path.join(__dirname, "../public")));

  // API routes
  app.use("/api", router);

  // HTMX view routes
  app.use("/views", viewRouter);

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const server = app.listen(PORT, () => {
    console.log(`Product Intent Graph API running on http://localhost:${PORT}`);
  });

  // Graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    server.close();
    await closeDriver();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
