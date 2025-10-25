// functions/api/rewardBatch.js
import { createClient } from "@supabase/supabase-js";

const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization,x-wallet-address,X-Wallet-Address",
};
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...corsHeaders, ...extra } });

export const onRequestOptions = () => new Response(null, { headers: corsHeaders });

function getWalletLowerFromAny(request, body) {
  let w = request.headers.get("X-Wallet-Address") || request.headers.get("x-wallet-address");
  if (!w && body?.wallet) w = body.wallet;
  if (!w) {
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(0x[a-fA-F0-9]{40})$/);
    if (m) w = m[1];
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(String(w || ""))) return null;
  return String(w).toLowerCase();
}

const ALLOWED_TOKENS = new Set(["CRKS","CRO","MOON","KRIS","BONE","BOBZ","CRY","CROCARD"]);

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const wallet = getWalletLowerFromAny(request, body);
    if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

    const rewards = body?.rewards || {};
    if (!rewards || typeof rewards !== "object" || Object.keys(rewards).length === 0) {
      return json({ error: "Missing rewards" }, 400);
    }

    const reason = String(body?.reason || "heist_reward");
    const ref = String(body?.ref || "");
    const idempotencyKey = String(body?.idempotency_key || `${reason}:${ref}:${Date.now()}:${Math.random().toString(36).slice(2,8)}`);

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
      global: { headers: { "x-client-info": "crooks-backend" } },
    });

    // 1) ensure user
    const up = await sb.from("users")
      .upsert({ wallet_address: wallet }, { onConflict: "wallet_address" })
      .select("id")
      .single();
    if (up.error) return json({ error: up.error.message }, 500);
    const user_id = up.data.id;

    // 2) idempotency guard
    const idem = await sb
      .from("idempotency_keys")
      .select("key,user_id,created_at")
      .eq("key", idempotencyKey)
      .eq("user_id", user_id)
      .maybeSingle();
    if (!idem.error && idem.data) {
      return json({ ok: true, idempotent: true }); // already done
    }

    // 3) normalize rewards → [{token_symbol, amount}]
    const items = [];
    for (const [symRaw, amtRaw] of Object.entries(rewards)) {
      const sym = String(symRaw || "").toUpperCase();
      const amt = Number(amtRaw);
      if (!ALLOWED_TOKENS.has(sym)) continue;               // ignore unknown tokens
      if (!Number.isFinite(amt) || amt <= 0) continue;      // ignore non-positive
      items.push({ token_symbol: sym, amount: amt });
    }
    if (items.length === 0) return json({ error: "No valid rewards" }, 400);

    // 4) write token_ledger rows (audit trail)
    const ledgerRows = items.map(it => ({
      user_id,
      token_symbol: it.token_symbol,
      amount: it.amount,
      reason,
      ref_id: null, // you can derive numeric ref if you have one
    }));
    const insLedger = await sb.from("token_ledger").insert(ledgerRows);
    if (insLedger.error) return json({ error: insLedger.error.message }, 500);

    // 5) update token_balances (read-modify-upsert; simple, adequate here)
    for (const it of items) {
      const cur = await sb
        .from("token_balances")
        .select("balance")
        .eq("user_id", user_id)
        .eq("token_symbol", it.token_symbol)
        .maybeSingle();

      const prev = (!cur.error && cur.data) ? Number(cur.data.balance || 0) : 0;
      const next = prev + Number(it.amount || 0);

      const up2 = await sb.from("token_balances").upsert({
        user_id,
        token_symbol: it.token_symbol,
        balance: next,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,token_symbol" });
      if (up2.error) return json({ error: up2.error.message }, 500);
    }

    // 6) record idempotency key
    const insKey = await sb.from("idempotency_keys").insert({
      key: idempotencyKey,
      user_id,
      created_at: new Date().toISOString(),
    });
    if (insKey.error) {
      // non-fatal; we already credited the user
      console.warn("[rewardBatch] idempotency insert failed:", insKey.error.message);
    }

    return json({ ok: true, user_id });
  } catch (e) {
    return json({ error: e?.message || "rewardBatch failed" }, 500);
  }
}
