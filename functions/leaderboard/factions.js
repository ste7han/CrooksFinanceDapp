import { json, supabaseAdmin } from "../_lib/backend.js";
export async function onRequestGet(context) {
  const db = supabaseAdmin(context.env);
  const url = new URL(context.request.url);
  const period = url.searchParams.get("period") || "all";
  const range = { week: "7 days", month: "30 days", all: null }[period];

  let q = db.from("faction_points_ledger").select("faction, points");
  if (range) q = q.gte("created_at", `now() - interval '${range}'`);

  const { data, error } = await q;
  if (error) return json(context, { error: error.message }, 500);

  const sum = {};
  for (const r of data)
    sum[r.faction] = (sum[r.faction] || 0) + Number(r.points || 0);

  const sorted = Object.entries(sum)
    .map(([faction, value]) => ({ faction, value }))
    .sort((a, b) => b.value - a.value);

  return json(context, sorted);
}
