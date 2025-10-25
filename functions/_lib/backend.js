// functions/_lib/backend.js
import { createClient } from "@supabase/supabase-js";

// Allowed tokens
export const ALLOWED_TOKENS = new Set([
  "CRO", "CRKS", "MOON", "KRIS", "BONE", "BOBZ", "CRY", "CROCARD",
]);

export function cors(request) {
  // Pages zit op hetzelfde domein als je frontend; * is OK hier
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Wallet-Address",
    "content-type": "application/json",
  };
}

export function json(request, body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(request), ...extra },
  });
}

export function getWalletLower(request) {
  let w = request.headers.get("X-Wallet-Address");
  if (!w) {
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(0x[a-fA-F0-9]{40})$/i);
    if (m) w = m[1];
  }
  if (!w) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(w) ? w.toLowerCase() : null;
}

export function isAdmin(request, env) {
  const admin = (env.ADMIN_WALLET || "").toLowerCase();
  const who = getWalletLower(request);
  return Boolean(admin && who && who === admin);
}

export function supabase(env) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
    global: { headers: { "x-client-info": "crooks-pages" } },
  });
}

// --- DB helpers ---
export async function getOrCreateUserId(sb, walletLower) {
  const { data, error } = await sb
    .from("users")
    .upsert({ wallet_address: walletLower }, { onConflict: "wallet_address" })
    .select("id,wallet_address")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

export async function addLedgerAndUpsertBalanceByUserId(
  sb, userId, symbol, delta, reason, refId
) {
  // ledger
  {
    const { error } = await sb.from("token_ledger").insert({
      user_id: userId, token_symbol: symbol, amount: delta,
      reason: reason || "reward", ref_id: refId ?? null,
    });
    if (error) throw new Error(error.message);
  }
  // current bal
  const { data: cur, error: selErr } = await sb
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .eq("token_symbol", symbol)
    .single();
  if (selErr && selErr.code !== "PGRST116") throw new Error(selErr.message);

  const newBal = (Number(cur?.balance) || 0) + Number(delta);

  const { error: upErr } = await sb
    .from("token_balances")
    .upsert({ user_id: userId, token_symbol: symbol, balance: newBal },
            { onConflict: "user_id,token_symbol" });
  if (upErr) throw new Error(upErr.message);
  return newBal;
}

// 🟢 Create admin Supabase client using service key
export function supabaseAdmin(env) {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing Supabase URL or service key in environment");

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}
