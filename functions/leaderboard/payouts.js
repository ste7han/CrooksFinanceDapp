import { json, supabaseAdmin } from "../_lib/backend.js";

export async function onRequestGet(context) {
  const db = supabaseAdmin(context.env);
  const url = new URL(context.request.url);
  const token = (url.searchParams.get("token") || "").toUpperCase();

  let q = db.from("token_ledger")
    .select("wallet_address, token_symbol, amount, reason")
    .eq("reason", "heist_reward");

  if (token && token !== "ALL") q = q.eq("token_symbol", token);

  const { data, error } = await q;
  if (error) return json(context, { error: error.message }, 500);

  const totals = {};
  for (const r of data) {
    const key = `${r.wallet_address}:${r.token_symbol}`;
    totals[key] = (totals[key] || 0) + Number(r.amount || 0);
  }

  const arr = Object.entries(totals)
    .map(([key, value]) => {
      const [wallet, token_symbol] = key.split(":");
      return { wallet, token: token_symbol, value };
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, 100);

  return json(context, arr);
}
