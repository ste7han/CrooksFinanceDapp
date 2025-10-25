// functions/api/me/withdrawals.js
import { createClient } from "@supabase/supabase-js";

const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,x-wallet-address,X-Wallet-Address",
};
const json = (b,s=200) => new Response(JSON.stringify(b),{status:s,headers:{...corsHeaders,"content-type":"application/json"}});

function getWalletLowerFromAny(request, url){
  let w = request.headers.get("X-Wallet-Address") || request.headers.get("x-wallet-address");
  if (!w) w = url.searchParams.get("wallet") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(w)) return null;
  return w.toLowerCase();
}

export const onRequestOptions = () => new Response(null, { headers: corsHeaders });

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const wallet = getWalletLowerFromAny(request, url);
    if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
      global: { headers: { "x-client-info": "crooks-backend" } },
    });

    const { data: u } = await sb.from("users").select("id").eq("wallet_address", wallet).single();
    if (!u?.id) return json({ totals: {}, recent: [] });

    // Totals by token from the ledger where reason='withdraw'
    const { data: rows, error } = await sb
      .rpc("sum_withdrawals_by_token", { p_user_id: u.id })
      .catch(() => ({ data:null, error: {message:"missing rpc"} }));

    // Fallback if RPC not created: do it client side
    let totals = {};
    if (!error && Array.isArray(rows)) {
      for (const r of rows) totals[r.token_symbol] = Number(r.total_amount || 0);
    } else {
      const { data: ledger } = await sb
        .from("token_ledger")
        .select("token_symbol,amount,reason,created_at")
        .eq("user_id", u.id)
        .eq("reason","withdraw")
        .limit(1000);
      for (const r of (ledger||[])) {
        const s = String(r.token_symbol).toUpperCase();
        totals[s] = (totals[s] || 0) + Number(r.amount || 0);
      }
    }

    // Recent 10 withdraws (from withdraw_requests if present)
    const { data: recent } = await sb
      .from("withdraw_requests")
      .select("token_symbol,amount,to_address,status,created_at,updated_at")
      .eq("user_id", u.id)
      .order("created_at",{ ascending:false })
      .limit(10);

    return json({ wallet, totals, recent: recent||[] });
  } catch (e) {
    return json({ error: e?.message || "summary failed" }, 500);
  }
}
