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

// --- DB helpers ---
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
  // ledger insert
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

// ---------- Rank caps (from your JSON) ----------
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
function capForRank(name) {
  return RANK_CAPS[name] ?? 0;
}

// Try to find rank for a user
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
  if (!users.error) {
    if (users.data?.rank_name) return users.data.rank_name;
    if (users.data?.rank) return users.data.rank;
  }
  return "Prospect";
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

    // =========================
    // STAMINA ENDPOINTS
    // =========================

    // GET /api/me/stamina
    if (path === "/api/me/stamina" && request.method === "GET") {
      const wallet = getWalletLower(request);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

      try {
        const userId = await getOrCreateUserId(supabase, wallet);
        const rankName = await getRankNameForUser_dbFirst(supabase, userId);
        const capFromRank = capForRank(rankName);

        const sel = await supabase
          .from("stamina_states")
          .select("stamina,cap,updated_at,last_tick_at")
          .eq("user_id", userId)
          .single();

        if (sel.error && sel.error.code === "PGRST116") {
          const payload = {
            user_id: userId,
            stamina: 0,
            cap: capFromRank,
            last_tick_at: new Date().toISOString(),
          };
          await supabase.from("stamina_states").upsert(payload, { onConflict: "user_id" });
          return json({
            wallet, user_id: userId, rank: rankName, stamina: 0, cap: capFromRank, fresh: true,
          });
        }

        if (sel.error) return json({ error: sel.error.message }, 500);

        let stamina = Number(sel.data?.stamina || 0);
        if (sel.data?.cap !== capFromRank) {
          stamina = Math.min(stamina, capFromRank);
          await supabase
            .from("stamina_states")
            .upsert({ user_id: userId, stamina, cap: capFromRank }, { onConflict: "user_id" });
        }

        return json({
          wallet,
          user_id: userId,
          rank: rankName,
          stamina,
          cap: capFromRank,
          updated_at: sel.data?.updated_at,
          last_tick_at: sel.data?.last_tick_at,
        });
      } catch (e) {
        return json({ error: e.message || "stamina fetch failed" }, 500);
      }
    }

    // POST /api/me/stamina/spend
    if (path === "/api/me/stamina/spend" && request.method === "POST") {
      const wallet = getWalletLower(request);
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
        const payload = {
          user_id: userId,
          stamina: next,
          cap,
          last_tick_at: new Date().toISOString(),
        };
        const { error: e2 } = await supabase
          .from("stamina_states")
          .upsert(payload, { onConflict: "user_id" });
        if (e2) return json({ error: e2.message }, 500);

        return json({ ok: true, wallet, user_id: userId, stamina: next, cap });
      } catch (e) {
        return json({ error: e.message || "stamina spend failed" }, 500);
      }
    }

    // --- rest of your existing routes ---
    // (health, heists, me, balances, ledger, reward, rewardBatch, admin routes)
    // Keep all the code you already have below here unchanged
    // --------------------------------------------------------

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

    // ... keep all your balances, ledger, rewardBatch, and admin routes unchanged ...

    return json({ error: "Not found" }, 404);
  },
};
