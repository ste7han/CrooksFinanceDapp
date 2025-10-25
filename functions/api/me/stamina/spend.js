// functions/api/me/stamina/spend.js
import { createClient } from "@supabase/supabase-js";

const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization,x-wallet-address,X-Wallet-Address",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });

export const onRequestOptions = () => new Response(null, { headers: corsHeaders });

function getWalletLowerFromAny(request, url) {
  let w = request.headers.get("X-Wallet-Address");
  if (!w) w = url.searchParams.get("wallet") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(w)) return null;
  return w.toLowerCase();
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const wallet = getWalletLowerFromAny(request, url);
  if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  try {
    const { amount } = await request.json().catch(() => ({}));
    const spend = Math.max(0, Number(amount || 0));
    if (spend <= 0) return json({ error: "Invalid amount" }, 400);

    // 1️⃣ user ophalen
    const { data: userRow, error: userErr } = await supabase
      .from("users")
      .select("id")
      .eq("wallet_address", wallet)
      .single();
    if (userErr) throw new Error(userErr.message);
    const userId = userRow.id;

    // 2️⃣ huidige stamina
    const { data: cur, error: stErr } = await supabase
      .from("stamina_states")
      .select("stamina, cap")
      .eq("user_id", userId)
      .single();
    if (stErr) throw new Error(stErr.message);

    const before = Number(cur.stamina || 0);
    const cap = Number(cur.cap || 0);

    if (before < spend) {
      return json({ error: "Not enough stamina", stamina: before, cap }, 400);
    }

    // 3️⃣ stamina aftrekken
    const next = Math.max(0, before - spend);
    const { error: upErr } = await supabase
      .from("stamina_states")
      .update({
        stamina: next,
        last_tick_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    if (upErr) throw new Error(upErr.message);

    return json({ ok: true, wallet, user_id: userId, stamina: next, cap });
  } catch (e) {
    return json({ error: e.message || "stamina spend failed" }, 500);
  }
}
