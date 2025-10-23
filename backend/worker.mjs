import { createClient } from "@supabase/supabase-js";

// Lock CORS to your Pages domain
const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Wallet-Address",
};

// Allow only the tokens in your economy
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

async function ensureUser(supabase, wallet) {
  await supabase.from("users").upsert({ wallet }, { onConflict: "wallet" });
}

async function addLedgerAndUpsertBalance(supabase, wallet, symbol, delta, reason, ref) {
  // 1) ledger
  const { error: ledErr } = await supabase
    .from("token_ledger")
    .insert({ wallet, token_symbol: symbol, amount: delta, reason: reason || "reward", ref: ref || null });
  if (ledErr) throw new Error(ledErr.message);

  // 2) balance upsert (simple read-modify-write; good enough now)
  const { data: cur, error: selErr } = await supabase
    .from("token_balances")
    .select("balance")
    .eq("wallet", wallet)
    .eq("token_symbol", symbol)
    .single();

  if (selErr && selErr.code !== "PGRST116") throw new Error(selErr.message);
  const newBal = (Number(cur?.balance) || 0) + Number(delta);

  const { error: upErr } = await supabase
    .from("token_balances")
    .upsert({ wallet, token_symbol: symbol, balance: newBal }, { onConflict: "wallet,token_symbol" });

  if (upErr) throw new Error(upErr.message);
  return newBal;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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
        .select("key,title,min_role,stamina_cost,recommended_strength,token_drops_min,token_drops_max,amount_usd_min,amount_usd_max,points_min,points_max,difficulty")
        .order("stamina_cost", { ascending: true })
        .order("title", { ascending: true });
      if (error) return json({ error: error.message }, 500);
      return json({ heists: data ?? [] });
    }

    // --- upsert user ---
    if (path === "/api/me" && request.method === "POST") {
      const { wallet } = await request.json().catch(() => ({}));
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);
      const lower = wallet.toLowerCase();
      const { data, error } = await supabase
        .from("users")
        .upsert({ wallet: lower }, { onConflict: "wallet" })
        .select()
        .single();
      if (error) return json({ error: error.message }, 500);
      return json({ user: data });
    }

    // --- balances ---
    if (path === "/api/me/balances" && request.method === "GET") {
      const wallet = getWalletLower(request);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);
      const { data, error } = await supabase
        .from("token_balances")
        .select("token_symbol,balance,updated_at")
        .eq("wallet", wallet)
        .order("token_symbol");
      if (error) return json({ error: error.message }, 500);
      // optionally filter to only allowed set (in case legacy rows exist)
      const rows = (data || []).filter(r => ALLOWED_TOKENS.has(String(r.token_symbol).toUpperCase()));
      return json({ wallet, balances: rows });
    }

    // --- ledger ---
    if (path === "/api/me/ledger" && request.method === "GET") {
      const wallet = getWalletLower(request);
      if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));
      const { data, error } = await supabase
        .from("token_ledger")
        .select("id,token_symbol,amount,reason,ref,created_at")
        .eq("wallet", wallet)
        .order("id", { ascending: false })
        .limit(limit);
      if (error) return json({ error: error.message }, 500);
      return json({ wallet, ledger: data ?? [] });
    }

    // --- single reward (still available) ---
    if (path === "/api/reward" && request.method === "POST") {
      const { wallet, token, amount, reason, ref } = await request.json().catch(() => ({}));
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);
      const sym = String(token || "").toUpperCase();
      if (!ALLOWED_TOKENS.has(sym)) return json({ error: `Token not allowed: ${sym}` }, 400);
      const delta = Number(amount);
      if (!Number.isFinite(delta)) return json({ error: "Invalid amount" }, 400);

      const w = wallet.toLowerCase();
      await ensureUser(supabase, w);
      const balance = await addLedgerAndUpsertBalance(supabase, w, sym, delta, reason, ref);
      return json({ ok: true, wallet: w, token: sym, balance });
    }

    // --- batch reward (preferred for heists) ---
    // body: { wallet: "0x...", rewards: { "CRO": 0.12, "MOON": 500, ... }, reason?: string, ref?: string }
    if (path === "/api/rewardBatch" && request.method === "POST") {
      const { wallet, rewards, reason, ref } = await request.json().catch(() => ({}));
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json({ error: "Invalid wallet" }, 400);
      if (!rewards || typeof rewards !== "object") return json({ error: "Missing rewards map" }, 400);

      const w = wallet.toLowerCase();
      await ensureUser(supabase, w);

      const results = {};
      for (const [rawSym, rawAmt] of Object.entries(rewards)) {
        const sym = String(rawSym).toUpperCase();
        if (!ALLOWED_TOKENS.has(sym)) continue; // silently skip unknown tokens
        const delta = Number(rawAmt);
        if (!Number.isFinite(delta) || delta === 0) continue;
        const bal = await addLedgerAndUpsertBalance(supabase, w, sym, delta, reason || "heist_reward", ref || null);
        results[sym] = bal;
      }
      return json({ ok: true, wallet: w, balances: results });
    }

    return json({ error: "Not found" }, 404);
  },
};
