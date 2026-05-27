import neo4j from "neo4j-driver";

const URI = "bolt://localhost:7687";
const USER = "neo4j";
const PASSWORD = "secretgraph";

// Create driver instance
const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

async function runQuery() {
  const session = driver.session();
  try {
    // Run a Cypher query
    const result = await session.run("RETURN $text AS message", {
      text: "Hello, Neo4j!",
    });
    const singleRecord = result.records[0];
    console.log(singleRecord.get("message"));
  } finally {
    await session.close();
  }
}

runQuery().catch(console.error);
