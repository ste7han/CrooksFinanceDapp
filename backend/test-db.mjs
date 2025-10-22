// backend/test-db.mjs
import pkg from "pg";
const { Client } = pkg;

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const res = await client.query("SELECT NOW() as now;");
  console.log("✅ Verbonden! Tijd op server:", res.rows[0].now);
} catch (err) {
  console.error("❌ Fout bij verbinden:", err.message);
} finally {
  await client.end();
}
