// functions/api/me/stamina/spend.js
import { createClient } from "@supabase/supabase-js";

const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization,x-wallet-address,X-Wallet-Address",
};
const json = (b,s=200,e={}) => new Response(JSON.stringify(b),{status:s,headers:{ "content-type":"application/json",...corsHeaders,...e }});

function getWalletLowerFromAny(request, url) {
  let w = request.headers.get("X-Wallet-Address") || request.headers.get("x-wallet-address");
  if (!w) {
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(0x[a-fA-F0-9]{40})$/);
    if (m) w = m[1];
  }
  if (!w) w = url.searchParams.get("wallet") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(w)) return null;
  return w.toLowerCase();
}

export const onRequestOptions = () => new Response(null, { headers: corsHeaders });

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const wallet = getWalletLowerFromAny(request, url);
  if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

  const { amount } = await request.json().catch(() => ({}));
  const spend = Math.max(0, Number(amount || 0));
  if (spend <= 0) return json({ error: "Invalid amount" }, 400);

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
    global: { headers: { "x-client-info": "crooks-backend" } },
  });

  try {
    const { data: user, error: uerr } = await sb
      .from("users")
      .upsert({ wallet_address: wallet }, { onConflict: "wallet_address" })
      .select("id")
      .single();
    if (uerr) return json({ error: uerr.message }, 500);
    const userId = user.id;

    const cur = await sb
      .from("stamina_states")
      .select("stamina,cap")
      .eq("user_id", userId)
      .single();

    if (cur.error && cur.error.code !== "PGRST116") return json({ error: cur.error.message }, 500);

    const before = Number(cur.data?.stamina || 0);
    if (before < spend) return json({ error: "Not enough stamina" }, 400);

    const next = Math.max(0, before - spend);
    const up = await sb.from("stamina_states").upsert(
      { user_id: userId, stamina: next, cap: Number(cur.data?.cap ?? 0), last_tick_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    if (up.error) return json({ error: up.error.message }, 500);

    return json({ ok: true, wallet, user_id: userId, stamina: next, cap: Number(cur.data?.cap ?? 0) });
  } catch (e) {
    return json({ error: e.message || "stamina spend failed" }, 500);
  }
}
