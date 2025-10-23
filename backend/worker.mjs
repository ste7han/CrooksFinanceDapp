// backend/worker.mjs
import { createClient } from "@supabase/supabase-js";

// Lock CORS to your Pages domain
const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Wallet-Address",
};

// Only track tokens in your economy
const ALLOWED_TOKENS = new Set([
  "CRO", "CRKS", "MOON", "KRIS", "BONE", "BOBZ", "CRY", "CROCARD",
]);

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...extra },
  });
}

function getWalletLower(request) {
  let w = request.headers.get("X-Wallet-Address");
  if (!w) {
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(0x[a-fA-F0-9]{40})$/);
    if (m) w = m[1];
  }
  if (!w) return null;
  return /^0x[a-fA-F0-9]{40}$/.test(w) ? w.toLowerCase() : null;
}

// --- DB helpers (user_id schema) ---
async function getOrCreateUserId(supabase, walletLower) {
  // upsert by wallet_address; return id
  const { data, error } = await supabase
    .from("users")
    .upsert({ wallet_address: walletLower }, { onConflict: "wallet_address" })
    .select("id,wallet_address")
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

async function addLedgerAndUpsertBalanceByUserId(
  supabase,
  userId,
  symbol,
  delta,
  reason,
  refId
) {
  // 1) ledger insert
  {
    const { error } = await supabase.from("token_ledger").insert({
      user_id: userId,
      token_symbol: symbol,
      amount: delta,
      reason: reason || "reward",
      ref_id: refId ?? null,
    });
    if (error) throw new Error(error.message);
  }

  // 2) read-modify-write balance
  const { data: cur, error: selErr } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .eq("token_symbol", symbol)
    .single();

  // PGRST116 = "Results contain 0 rows" (not found) → that's fine for first insert
  if (selErr && selErr.code !== "PGRST116") throw new Error(selErr.message);

  const newBal = (Number(cur?.balance) || 0) + Number(delta);

  const { error: upErr } = await supabase
    .from("token_balances")
    .upsert(
      { user_id: userId, token_symbol: symbol, balance: newBal },
      { onConflict: "user_id,token_symbol" }
    );

  if (upErr) throw new Error(upErr.message);
  return newBal;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
      global: { headers: { "x-client-info": "crooks-backend" } },
    });

    // --- health ---
    if (path === "/api/health" && request.method === "GET") {
      const { error } = await supabase.from("heists").select("key").limit(1);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    // --- heists list ---
    if (path === "/api/heists" && request.method === "GET") {
      const { data, error } = await supabase
        .from("heists")
        .select(
          "key,title,min_role,stamina_cost,recommended_strength,token_drops_min,token_drops_max,amount_usd_min,amount_usd_max,points_min,points_max,difficulty"
        )
        .order("stamina_cost", { ascending: true })
        .order("title", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ heists: data ?? [] });
    }

    // --- upsert user (by wallet_address) ---
    if (path === "/api/me" && request.method === "POST") {
      const { wallet } = await request.json().catch(() => ({}));
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) {
        return json({ error: "Invalid wallet" }, 400);
      }
      const lower = wallet.toLowerCase();
      const { data, error } = await supabase
        .from("users")
        .upsert({ wallet_address: lower }, { onConflict: "wallet_address" })
        .select("id,wallet_address")
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ user: { id: data.id, wallet: data.wallet_address } });
    }

    // --- balances (by user_id) ---
    if (path === "/api/me/balances" && request.method === "GET") {
      const wallet = getWalletLower(request);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

      let userId;
      try {
        userId = await getOrCreateUserId(supabase, wallet);
      } catch (e) {
        return json({ error: e.message || "User upsert failed" }, 500);
      }

      const { data, error } = await supabase
        .from("token_balances")
        .select("token_symbol,balance,updated_at")
        .eq("user_id", userId)
        .order("token_symbol");

      if (error) return json({ error: error.message }, 500);

      const rows = (data || []).filter((r) =>
        ALLOWED_TOKENS.has(String(r.token_symbol).toUpperCase())
      );
      return json({ wallet, user_id: userId, balances: rows });
    }

    // --- ledger (by user_id) ---
    if (path === "/api/me/ledger" && request.method === "GET") {
      const wallet = getWalletLower(request);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

      let userId;
      try {
        userId = await getOrCreateUserId(supabase, wallet);
      } catch (e) {
        return json({ error: e.message || "User upsert failed" }, 500);
      }

      const limit = Math.max(
        1,
        Math.min(200, Number(url.searchParams.get("limit") || 50))
      );

      const { data, error } = await supabase
        .from("token_ledger")
        .select("id,token_symbol,amount,reason,ref_id,created_at")
        .eq("user_id", userId)
        .order("id", { ascending: false })
        .limit(limit);

      if (error) return json({ error: error.message }, 500);
      return json({ wallet, user_id: userId, ledger: data ?? [] });
    }

    // --- single reward (server-authoritative) ---
    // body: { wallet, token, amount, reason?, ref_id? }
    if (path === "/api/reward" && request.method === "POST") {
      const { wallet, token, amount, reason, ref_id } =
        await request.json().catch(() => ({}));

      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) {
        return json({ error: "Invalid wallet" }, 400);
      }
      const sym = String(token || "").toUpperCase();
      if (!ALLOWED_TOKENS.has(sym))
        return json({ error: `Token not allowed: ${sym}` }, 400);
      const delta = Number(amount);
      if (!Number.isFinite(delta))
        return json({ error: "Invalid amount" }, 400);

      let userId;
      try {
        userId = await getOrCreateUserId(supabase, wallet.toLowerCase());
        const balance = await addLedgerAndUpsertBalanceByUserId(
          supabase,
          userId,
          sym,
          delta,
          reason,
          ref_id
        );
        return json({
          ok: true,
          wallet: wallet.toLowerCase(),
          user_id: userId,
          token: sym,
          balance,
        });
      } catch (e) {
        return json({ error: e.message || "Reward failed" }, 500);
      }
    }

    // --- batch reward (preferred for heists) ---
    // body: { wallet: "0x...", rewards: { "CRO": 0.12, "MOON": 500, ... }, reason?: string, ref_id?: number }
    if (path === "/api/rewardBatch" && request.method === "POST") {
      const { wallet, rewards, reason, ref_id } = await request
        .json()
        .catch(() => ({}));

      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) {
        return json({ error: "Invalid wallet" }, 400);
      }
      if (!rewards || typeof rewards !== "object") {
        return json({ error: "Missing rewards map" }, 400);
      }

      try {
        const w = wallet.toLowerCase();
        const userId = await getOrCreateUserId(supabase, w);

        const results = {};
        for (const [rawSym, rawAmt] of Object.entries(rewards)) {
          const sym = String(rawSym).toUpperCase();
          if (!ALLOWED_TOKENS.has(sym)) continue; // ignore unknown tokens
          const delta = Number(rawAmt);
          if (!Number.isFinite(delta) || delta === 0) continue;

          const bal = await addLedgerAndUpsertBalanceByUserId(
            supabase,
            userId,
            sym,
            delta,
            reason || "heist_reward",
            ref_id ?? null
          );
          results[sym] = bal;
        }

        return json({ ok: true, wallet: w, user_id: userId, balances: results });
      } catch (e) {
        return json({ error: e.message || "Batch reward failed" }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  },
};
