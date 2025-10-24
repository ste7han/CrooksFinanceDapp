// backend/worker.mjs
import { createClient } from "@supabase/supabase-js";

// ---- CORS ----
const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Wallet-Address",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...extra },
  });
}

function getWalletLowerFromAny(request, url) {
  // Header first
  let w = request.headers.get("X-Wallet-Address");
  // Bearer fallback
  if (!w) {
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(0x[a-fA-F0-9]{40})$/);
    if (m) w = m[1];
  }
  // Query fallback so you can test in the browser:
  if (!w) w = url.searchParams.get("wallet") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(w)) return null;
  return w.toLowerCase();
}

// ---- Wallet helpers ----
function getWalletLowerFromAny(request, url) {
  // Header first
  let w = request.headers.get("X-Wallet-Address");
  // Bearer fallback
  if (!w) {
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(0x[a-fA-F0-9]{40})$/);
    if (m) w = m[1];
  }
  // Query fallback: /api/me/stamina?wallet=0x...
  if (!w) w = url.searchParams.get("wallet") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(w)) return null;
  return w.toLowerCase();
}

function isAdmin(request, env) {
  const admin = (env.ADMIN_WALLET || "").toLowerCase();
  const who = getWalletLowerFromAny(request, new URL(request.url));
  return admin && who && who === admin;
}

// ---- Token allowlist ----
const ALLOWED_TOKENS = new Set([
  "CRO", "CRKS", "MOON", "KRIS", "BONE", "BOBZ", "CRY", "CROCARD",
]);

// ---- DB helpers ----
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
  supabase, userId, symbol, delta, reason, refId
) {
  const { error: ledgerErr } = await supabase.from("token_ledger").insert({
    user_id: userId,
    token_symbol: symbol,
    amount: delta,
    reason: reason || "reward",
    ref_id: refId ?? null,
  });
  if (ledgerErr) throw new Error(ledgerErr.message);

  const { data: cur, error: selErr } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .eq("token_symbol", symbol)
    .single();
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

// ---- Rank caps (from your heists JSON) ----
const RANK_CAPS = {
  "Prospect": 0,
  "Member": 2,
  "Hustler": 4,
  "Street Soldier": 6,
  "Enforcer": 8,
  "Officer": 10,
  "Captain": 12,
  "General": 14,
  "Gang Leader": 16,
  "Boss": 18,
  "Kingpin": 18,
  "Overlord": 19,
  "Icon": 19,
  "Legend": 20,
  "Immortal": 20,
};
const capForRank = (name) => RANK_CAPS[name] ?? 0;

async function getRankNameForUser_dbFirst(supabase, userId) {
  const view = await supabase
    .from("v_user_rank")
    .select("rank_name")
    .eq("user_id", userId)
    .single();
  if (!view.error && view.data?.rank_name) return view.data.rank_name;

  const users = await supabase
    .from("users")
    .select("rank_name,rank")
    .eq("id", userId)
    .single();
  if (!users.error) return users.data?.rank_name || users.data?.rank || "Prospect";

  return "Prospect";
}

// ---- Path util (normalize & easy matching) ----
const norm = (p) => (p || "/").replace(/\/+$/g, "") || "/";    // strips trailing slashes
const is = (p, s) => norm(p) === norm(s);

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = norm(url.pathname);

    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
      global: { headers: { "x-client-info": "crooks-backend" } },
    });

    // =========================
    // STAMINA ENDPOINTS (placed early)
    // =========================

    // GET /api/me/stamina
    if (is(path, "/api/me/stamina") && request.method === "GET") {
      const wallet = getWalletLowerFromAny(request, url);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);
      try {
        const userId = await getOrCreateUserId(supabase, wallet);
        const rankName = await getRankNameForUser_dbFirst(supabase, userId);
        const cap = capForRank(rankName);

        const sel = await supabase
          .from("stamina_states")
          .select("stamina,cap,updated_at,last_tick_at")
          .eq("user_id", userId)
          .single();

        if (sel.error && sel.error.code === "PGRST116") {
          const payload = {
            user_id: userId,
            stamina: 0,
            cap,
            last_tick_at: new Date().toISOString(),
          };
          const up = await supabase.from("stamina_states").upsert(payload, { onConflict: "user_id" });
          if (up.error) return json({ error: up.error.message }, 500);
          return json({ wallet, user_id: userId, rank: rankName, stamina: 0, cap, fresh: true });
        }
        if (sel.error) return json({ error: sel.error.message }, 500);

        let stamina = Number(sel.data?.stamina || 0);
        if (sel.data?.cap !== cap) {
          stamina = Math.min(stamina, cap);
          await supabase
            .from("stamina_states")
            .upsert({ user_id: userId, stamina, cap }, { onConflict: "user_id" });
        }

        return json({
          wallet, user_id: userId, rank: rankName,
          stamina, cap, updated_at: sel.data?.updated_at, last_tick_at: sel.data?.last_tick_at,
        });
      } catch (e) {
        return json({ error: e.message || "stamina fetch failed" }, 500);
      }
    }

    // POST /api/me/stamina/spend
    if (is(path, "/api/me/stamina/spend") && request.method === "POST") {
      const wallet = getWalletLowerFromAny(request, url);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

      const { amount } = await request.json().catch(() => ({}));
      const spend = Math.max(0, Number(amount || 0));
      if (spend <= 0) return json({ error: "Invalid amount" }, 400);

      try {
        const userId = await getOrCreateUserId(supabase, wallet);
        const cur = await supabase
          .from("stamina_states")
          .select("stamina,cap")
          .eq("user_id", userId)
          .single();

        if (cur.error && cur.error.code !== "PGRST116")
          return json({ error: cur.error.message }, 500);

        const rankName = await getRankNameForUser_dbFirst(supabase, userId);
        const cap = capForRank(rankName);
        const before = Number(cur.data?.stamina || 0);
        if (before < spend) return json({ error: "Not enough stamina" }, 400);

        const next = Math.max(0, before - spend);
        const up = await supabase
          .from("stamina_states")
          .upsert(
            { user_id: userId, stamina: next, cap, last_tick_at: new Date().toISOString() },
            { onConflict: "user_id" }
          );
        if (up.error) return json({ error: up.error.message }, 500);

        return json({ ok: true, wallet, user_id: userId, stamina: next, cap });
      } catch (e) {
        return json({ error: e.message || "stamina spend failed" }, 500);
      }
    }

    // =========================
    // REST OF YOUR EXISTING API
    // =========================

    // health
    if (is(path, "/api/health") && request.method === "GET") {
      const { error } = await supabase.from("heists").select("key").limit(1);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    // heists list
    if (is(path, "/api/heists") && request.method === "GET") {
      const { data, error } = await supabase
        .from("heists")
        .select("key,title,min_role,stamina_cost,recommended_strength,token_drops_min,token_drops_max,amount_usd_min,amount_usd_max,points_min,points_max,difficulty")
        .order("stamina_cost", { ascending: true })
        .order("title", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ heists: data ?? [] });
    }

    // upsert user
    if (is(path, "/api/me") && request.method === "POST") {
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

    // balances
    if (is(path, "/api/me/balances") && request.method === "GET") {
      const wallet = getWalletLowerFromAny(request, url);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);
      try {
        const userId = await getOrCreateUserId(supabase, wallet);
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
      } catch (e) {
        return json({ error: e.message || "User upsert failed" }, 500);
      }
    }

    // ledger
    if (is(path, "/api/me/ledger") && request.method === "GET") {
      const wallet = getWalletLowerFromAny(request, url);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);
      try {
        const userId = await getOrCreateUserId(supabase, wallet);
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
        const { data, error } = await supabase
          .from("token_ledger")
          .select("id,token_symbol,amount,reason,ref_id,created_at")
          .eq("user_id", userId)
          .order("id", { ascending: false })
          .limit(limit);
        if (error) return json({ error: error.message }, 500);
        return json({ wallet, user_id: userId, ledger: data ?? [] });
      } catch (e) {
        return json({ error: e.message || "User upsert failed" }, 500);
      }
    }

    // single reward
    if (is(path, "/api/reward") && request.method === "POST") {
      const { wallet, token, amount, reason, ref_id } = await request.json().catch(() => ({}));
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);
      const sym = String(token || "").toUpperCase();
      if (!ALLOWED_TOKENS.has(sym)) return json({ error: `Token not allowed: ${sym}` }, 400);
      const delta = Number(amount);
      if (!Number.isFinite(delta)) return json({ error: "Invalid amount" }, 400);
      try {
        const userId = await getOrCreateUserId(supabase, wallet.toLowerCase());
        const balance = await addLedgerAndUpsertBalanceByUserId(supabase, userId, sym, delta, reason, ref_id);
        return json({ ok: true, wallet: wallet.toLowerCase(), user_id: userId, token: sym, balance });
      } catch (e) {
        return json({ error: e.message || "Reward failed" }, 500);
      }
    }

    // batch reward
    if (is(path, "/api/rewardBatch") && request.method === "POST") {
      const { wallet, rewards, reason, ref_id } = await request.json().catch(() => ({}));
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);
      if (!rewards || typeof rewards !== "object") return json({ error: "Missing rewards map" }, 400);
      try {
        const w = wallet.toLowerCase();
        const userId = await getOrCreateUserId(supabase, w);
        const results = {};
        for (const [rawSym, rawAmt] of Object.entries(rewards)) {
          const sym = String(rawSym).toUpperCase();
          if (!ALLOWED_TOKENS.has(sym)) continue;
          const delta = Number(rawAmt);
          if (!Number.isFinite(delta) || delta === 0) continue;
          const bal = await addLedgerAndUpsertBalanceByUserId(supabase, userId, sym, delta, reason || "heist_reward", ref_id ?? null);
          results[sym] = bal;
        }
        return json({ ok: true, wallet: w, user_id: userId, balances: results });
      } catch (e) {
        return json({ error: e.message || "Batch reward failed" }, 500);
      }
    }

    // ============================
    // ADMIN
    // ============================
    if (path.startsWith("/api/admin/")) {
      if (!isAdmin(request, env)) return json({ error: "forbidden" }, 403);

      if (is(path, "/api/admin/resetAllBalances") && request.method === "POST") {
        const { token } = await request.json().catch(() => ({}));
        try {
          if (token) {
            const sym = String(token).toUpperCase();
            if (!ALLOWED_TOKENS.has(sym)) return json({ error: "Token not allowed" }, 400);
            const { error } = await supabase.from("token_balances").update({ balance: 0 }).eq("token_symbol", sym);
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true, reset: sym });
          } else {
            const { error } = await supabase.from("token_balances").update({ balance: 0 });
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true });
          }
        } catch (e) {
          return json({ error: e.message || "Reset failed" }, 500);
        }
      }

      if (is(path, "/api/admin/resetWalletBalances") && request.method === "POST") {
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
            const { error } = await supabase.from("token_balances").update({ balance: 0 }).eq("user_id", userId);
            if (error) return json({ error: error.message }, 500);
          }
          return json({ ok: true, wallet: lower });
        } catch (e) {
          return json({ error: e.message || "Reset failed" }, 500);
        }
      }

      if (is(path, "/api/admin/addFunds") && request.method === "POST") {
        const { wallet, token, amount } = await request.json().catch(() => ({}));
        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);
        const sym = String(token || "").toUpperCase();
        if (!ALLOWED_TOKENS.has(sym)) return json({ error: "Token not allowed" }, 400);
        const delta = Number(amount);
        if (!Number.isFinite(delta)) return json({ error: "Invalid amount" }, 400);
        try {
          const userId = await getOrCreateUserId(supabase, wallet.toLowerCase());
          const newBal = await addLedgerAndUpsertBalanceByUserId(supabase, userId, sym, delta, "admin_add", null);
          return json({ ok: true, wallet: wallet.toLowerCase(), token: sym, balance: newBal });
        } catch (e) {
          return json({ error: e.message || "Add funds failed" }, 500);
        }
      }

      if (is(path, "/api/admin/grantStamina") && request.method === "POST") {
        const { wallet, delta } = await request.json().catch(() => ({}));
        if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);
        try {
          const lower = wallet.toLowerCase();
          const userId = await getOrCreateUserId(supabase, lower);
          const { data: cur, error: e1 } = await supabase.from("stamina_states")
            .select("stamina,cap").eq("user_id", userId).single();
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
          const { error: e2 } = await supabase.from("stamina_states").upsert(payload, { onConflict: "user_id" });
          if (e2) return json({ error: e2.message }, 500);
          return json({ ok: true, wallet: lower, stamina: next, cap: payload.cap });
        } catch (e) {
          return json({ error: e.message || "Grant stamina failed" }, 500);
        }
      }

      if (is(path, "/api/admin/holdingsSummary") && request.method === "GET") {
        try {
          let rows, error;
          ({ data: rows, error } = await supabase
            .from("v_user_balances")
            .select("wallet_address,token_symbol,balance,updated_at"));
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

      return json({ error: "Not found" }, 404);
    }

    // Default 404
    return json({ error: "Not found" }, 404);
  },
};
