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

function isAdmin(request, env) {
  const admin = (env.ADMIN_WALLET || "").toLowerCase();
  const who = getWalletLower(request);
  return admin && who && who === admin;
}

// --- DB helpers (user_id schema) ---
async function getOrCreateUserId(supabase, walletLower) {
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

  // PGRST116 = "Results contain 0 rows" (not found) → first insert is fine
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

      try {
        const userId = await getOrCreateUserId(supabase, wallet.toLowerCase());
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

    // ============================
    //          ADMIN API
    // ============================
    if (path.startsWith("/api/admin/")) {
      if (!isAdmin(request, env)) return json({ error: "forbidden" }, 403);

      // Reset ALL balances (optionally only for one token)
      if (path === "/api/admin/resetAllBalances" && request.method === "POST") {
        const { token } = await request.json().catch(() => ({}));
        try {
          if (token) {
            const sym = String(token).toUpperCase();
            if (!ALLOWED_TOKENS.has(sym)) return json({ error: "Token not allowed" }, 400);
            const { error } = await supabase
              .from("token_balances")
              .update({ balance: 0 })
              .eq("token_symbol", sym);
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true, reset: sym });
          } else {
            const { error } = await supabase
              .from("token_balances")
              .update({ balance: 0 });
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true });
          }
        } catch (e) {
          return json({ error: e.message || "Reset failed" }, 500);
        }
      }

      // Reset balances for a specific wallet (all or one token)
      if (path === "/api/admin/resetWalletBalances" && request.method === "POST") {
        const { wallet, token } = await request.json().catch(() => ({}));
        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);

        try {
          const lower = wallet.toLowerCase();
          const userId = await getOrCreateUserId(supabase, lower);

          if (token) {
            const sym = String(token).toUpperCase();
            if (!ALLOWED_TOKENS.has(sym)) return json({ error: "Token not allowed" }, 400);
            const { error } = await supabase
              .from("token_balances")
              .upsert({ user_id: userId, token_symbol: sym, balance: 0 }, { onConflict: "user_id,token_symbol" });
            if (error) return json({ error: error.message }, 500);
          } else {
            const { error } = await supabase
              .from("token_balances")
              .update({ balance: 0 })
              .eq("user_id", userId);
            if (error) return json({ error: error.message }, 500);
          }
          return json({ ok: true, wallet: lower });
        } catch (e) {
          return json({ error: e.message || "Reset failed" }, 500);
        }
      }

      // Add funds (single wallet)
      if (path === "/api/admin/addFunds" && request.method === "POST") {
        const { wallet, token, amount } = await request.json().catch(() => ({}));
        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);
        const sym = String(token || "").toUpperCase();
        if (!ALLOWED_TOKENS.has(sym)) return json({ error: "Token not allowed" }, 400);
        const delta = Number(amount);
        if (!Number.isFinite(delta)) return json({ error: "Invalid amount" }, 400);

        try {
          const userId = await getOrCreateUserId(supabase, wallet.toLowerCase());
          const newBal = await addLedgerAndUpsertBalanceByUserId(
            supabase,
            userId,
            sym,
            delta,
            "admin_add",
            null
          );
          return json({ ok: true, wallet: wallet.toLowerCase(), token: sym, balance: newBal });
        } catch (e) {
          return json({ error: e.message || "Add funds failed" }, 500);
        }
      }

      // Grant stamina to a wallet (adds delta, clamps to cap if cap>0)
      if (path === "/api/admin/grantStamina" && request.method === "POST") {
        const { wallet, delta } = await request.json().catch(() => ({}));
        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);

        try {
          const lower = wallet.toLowerCase();
          const userId = await getOrCreateUserId(supabase, lower);

          const { data: cur, error: e1 } = await supabase
            .from("stamina_states")
            .select("stamina,cap")
            .eq("user_id", userId)
            .single();
          if (e1 && e1.code !== "PGRST116") return json({ error: e1.message }, 500);

          const add = Number(delta) || 0;
          const cap = Number(cur?.cap || 0);
          const curStam = Number(cur?.stamina || 0);

          let next = curStam + add;
          if (cap > 0) next = Math.min(next, cap);
          if (next < 0) next = 0;

          const payload = {
            user_id: userId,
            stamina: next,
            cap: cap || (cur ? cap : 0),
            last_tick_at: new Date().toISOString(),
          };

          const { error: e2 } = await supabase
            .from("stamina_states")
            .upsert(payload, { onConflict: "user_id" });

          if (e2) return json({ error: e2.message }, 500);
          return json({ ok: true, wallet: lower, stamina: next, cap: payload.cap });
        } catch (e) {
          return json({ error: e.message || "Grant stamina failed" }, 500);
        }
      }

      // Holdings overview (totals + per wallet)
      if (path === "/api/admin/holdingsSummary" && request.method === "GET") {
        try {
          // Try the view first (if present in your schema.sql)
          let rows, error;

          ({ data: rows, error } = await supabase
            .from("v_user_balances")
            .select("wallet_address,token_symbol,balance,updated_at"));

          // Fallback if the view doesn't exist
          if (error) {
            const join = await supabase
              .from("token_balances")
              .select("user_id,token_symbol,balance,updated_at");
            if (join.error) return json({ error: join.error.message }, 500);

            const users = await supabase.from("users").select("id,wallet_address");
            if (users.error) return json({ error: users.error.message }, 500);

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

          return json({ totals, rows: rows || [] });
        } catch (e) {
          return json({ error: e.message || "Summary failed" }, 500);
        }
      }

      // Unknown admin route
      return json({ error: "Not found" }, 404);
    }

    // --- default 404 for non-matched routes ---
    return json({ error: "Not found" }, 404);
  },
};
