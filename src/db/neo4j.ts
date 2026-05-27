import neo4j, { Driver } from "neo4j-driver";

const URI = process.env.NEO4J_URI || "bolt://localhost:7687";
const USER = process.env.NEO4J_USER || "neo4j";
const PASSWORD = process.env.NEO4J_PASSWORD || "secretgraph";

let driver: Driver;

export function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));
  }
  return driver;
}

export async function closeDriver(): Promise<void> {
  if (driver) {
    await driver.close();
  }
}

/**
 * Initialize Neo4j schema: constraints and indexes for the intent graph.
 */
export async function initSchema(): Promise<void> {
  const session = getDriver().session();
  try {
    // Unique constraints
    await session.run(`
      CREATE CONSTRAINT intent_id IF NOT EXISTS
      FOR (i:Intent) REQUIRE i.id IS UNIQUE
    `);
    await session.run(`
      CREATE CONSTRAINT graph_node_id IF NOT EXISTS
      FOR (n:GraphNode) REQUIRE n.id IS UNIQUE
    `);
    await session.run(`
      CREATE CONSTRAINT condition_id IF NOT EXISTS
      FOR (c:AcceptanceCondition) REQUIRE c.id IS UNIQUE
    `);
    await session.run(`
      CREATE CONSTRAINT boundary_id IF NOT EXISTS
      FOR (b:SatisfactionBoundary) REQUIRE b.id IS UNIQUE
    `);
    await session.run(`
      CREATE CONSTRAINT design_artifact_id IF NOT EXISTS
      FOR (d:DesignArtifact) REQUIRE d.id IS UNIQUE
    `);
    await session.run(`
      CREATE CONSTRAINT work_package_id IF NOT EXISTS
      FOR (w:WorkPackage) REQUIRE w.id IS UNIQUE
    `);

    // Indexes for common lookups
    await session.run(`
      CREATE INDEX intent_status IF NOT EXISTS
      FOR (i:Intent) ON (i.status)
    `);
    await session.run(`
      CREATE INDEX node_intent IF NOT EXISTS
      FOR (n:GraphNode) ON (n.intentId)
    `);
    await session.run(`
      CREATE INDEX node_type IF NOT EXISTS
      FOR (n:GraphNode) ON (n.type)
    `);
    await session.run(`
      CREATE INDEX condition_intent IF NOT EXISTS
      FOR (c:AcceptanceCondition) ON (c.intentId)
    `);

    console.log("Neo4j schema initialized.");
  } finally {
    await session.close();
  }
}
