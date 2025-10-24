// functions/api/admin/holdingsSummary.js
import { json, supabase, isAdmin, ALLOWED_TOKENS } from "../../_lib/backend";

export const onRequestGet = async ({ request, env }) => {
  if (!isAdmin(request, env)) return json(request, { error: "forbidden" }, 403);
  const sb = supabase(env);

  try {
    // probeer view
    let rows, error;
    ({ data: rows, error } = await sb
      .from("v_user_balances")
      .select("wallet_address,token_symbol,balance,updated_at"));
    if (error) {
      // fallback join
      const join = await sb
        .from("token_balances")
        .select("user_id,token_symbol,balance,updated_at");
      if (join.error) return json(request, { error: join.error.message }, 500);
      const users = await sb.from("users").select("id,wallet_address");
      if (users.error) return json(request, { error: users.error.message }, 500);
      const map = new Map(users.data.map(u => [u.id, u.wallet_address]));
      rows = (join.data || []).map(r => ({
        wallet_address: map.get(r.user_id) || null,
        token_symbol: r.token_symbol,
        balance: r.balance,
        updated_at: r.updated_at,
      }));
    }

    const totals = {};
    for (const r of rows || []) {
      const sym = String(r.token_symbol).toUpperCase();
      if (!ALLOWED_TOKENS.has(sym)) continue;
      totals[sym] = (totals[sym] || 0) + Number(r.balance || 0);
    }
    return json(request, { totals, rows: rows || [] });
  } catch (e) {
    return json(request, { error: e.message || "Summary failed" }, 500);
  }
};
