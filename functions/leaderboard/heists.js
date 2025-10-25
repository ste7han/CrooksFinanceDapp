import { json, supabaseAdmin } from "../_lib/backend.js";
export async function onRequestGet(context) {
  const db = supabaseAdmin(context.env);
  const url = new URL(context.request.url);
  const period = url.searchParams.get("period") || "all";

  const range = {
    week: "7 days",
    month: "30 days",
    all: null,
  }[period];

  let q = db.from("heist_results")
    .select("wallet_address, success")
    .eq("success", true);

  if (range) q = q.gte("created_at", `now() - interval '${range}'`);

  const { data, error } = await q;
  if (error) return json(context, { error: error.message }, 500);

  const counts = {};
  for (const r of data) counts[r.wallet_address] = (counts[r.wallet_address] || 0) + 1;

  const sorted = Object.entries(counts)
    .map(([wallet, value]) => ({ wallet, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 100);

  return json(context, sorted);
}
