// backend/seeds/seed_heists_from_json.mjs
// Doel: heists.json -> SQL INSERTs voor tabel `heists`
// Run: node backend/seeds/seed_heists_from_json.mjs

import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// Pad naar jouw bestaande JSON
const jsonPath = path.resolve(__dirname, "../../src/data/heists.json");
// Output SQL-bestand
const outPath  = path.resolve(__dirname, "./heists_seed.sql");

function esc(value) {
  if (value == null) return "NULL";
  return "'" + String(value).replace(/'/g, "''") + "'";
}

try {
  const raw = fs.readFileSync(jsonPath, "utf-8");
  const data = JSON.parse(raw);

  // data.heists is een object: { key: { ...config }, ... }
  const entries = Object.entries(data.heists || {});
  if (entries.length === 0) {
    console.error("Geen heists gevonden in heists.json");
    process.exit(1);
  }

  const lines = [];
  lines.push("-- Auto-generated from src/data/heists.json");
  lines.push("BEGIN;");

  for (const [key, h] of entries) {
    const title = h.title || key;
    const min_role = h.min_role || "Prospect";
    const stamina_cost = Number(h.stamina_cost || 0);
    const rec = Number(h.recommended_strength || 0);

    // token_drops: {min, max}
    const tdMin = Number(h.token_drops?.min ?? 1);
    const tdMax = Number(h.token_drops?.max ?? tdMin);

    // amount_usd_range: [min, max]
    const usdMin = Number((h.amount_usd_range?.[0]) ?? 0);
    const usdMax = Number((h.amount_usd_range?.[1]) ?? usdMin);

    // points_if_success: [min, max]
    const ptsMin = Number((h.points_if_success?.[0]) ?? 0);
    const ptsMax = Number((h.points_if_success?.[1]) ?? ptsMin);

    const difficulty = h.difficulty || null;

    lines.push(
      `INSERT INTO heists (key, title, min_role, stamina_cost, recommended_strength, token_drops_min, token_drops_max, amount_usd_min, amount_usd_max, points_min, points_max, difficulty)
       VALUES (${esc(key)}, ${esc(title)}, ${esc(min_role)}, ${stamina_cost}, ${rec}, ${tdMin}, ${tdMax}, ${usdMin}, ${usdMax}, ${ptsMin}, ${ptsMax}, ${esc(difficulty)})
       ON CONFLICT (key) DO UPDATE SET
         title=${esc(title)},
         min_role=${esc(min_role)},
         stamina_cost=${stamina_cost},
         recommended_strength=${rec},
         token_drops_min=${tdMin},
         token_drops_max=${tdMax},
         amount_usd_min=${usdMin},
         amount_usd_max=${usdMax},
         points_min=${ptsMin},
         points_max=${ptsMax},
         difficulty=${esc(difficulty)};`
    );
  }

  lines.push("COMMIT;");
  fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log("✅ Klaar! SQL seed gemaakt op:", outPath);
  console.log("Open het bestand en plak het in je DB SQL editor. Run het daar.");
} catch (e) {
  console.error("Fout:", e.message);
  process.exit(1);
}
