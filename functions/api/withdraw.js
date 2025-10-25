// functions/api/withdraw.js
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";

const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization,x-wallet-address,X-Wallet-Address",
};
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...extra },
  });

const ALLOWED_TOKENS = new Set(["CRO","CRKS","MOON","KRIS","BONE","BOBZ","CRY","CROCARD"]);
const ERC20_ABI = [
  "function transfer(address to, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)"
];

function getWalletLowerFromAny(request, url){
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

async function getOrCreateUserId(sb, walletLower) {
  const { data, error } = await sb
    .from("users")
    .upsert({ wallet_address: walletLower }, { onConflict: "wallet_address" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function getBalance(sb, userId, symbol){
  const { data, error } = await sb
    .from("token_balances")
    .select("balance")
    .eq("user_id", userId)
    .eq("token_symbol", symbol)
    .single();
  if (error && error.code !== "PGRST116") throw new Error(error.message);
  return Number(data?.balance || 0);
}

async function addLedgerAndSetBalance(sb, userId, symbol, delta){
  // ledger
  const { error: lerr } = await sb.from("token_ledger").insert({
    user_id: userId,
    token_symbol: symbol,
    amount: delta,
    reason: delta < 0 ? "withdraw" : "admin_adjust",
    ref_id: null,
  });
  if (lerr) throw new Error(lerr.message);

  // recompute balance
  const cur = await getBalance(sb, userId, symbol);
  const newBal = cur + delta;
  const { error: uerr } = await sb
    .from("token_balances")
    .upsert({ user_id: userId, token_symbol: symbol, balance: newBal }, { onConflict: "user_id,token_symbol" });
  if (uerr) throw new Error(uerr.message);
  return newBal;
}

export const onRequestOptions = () => new Response(null, { headers: corsHeaders });

export async function onRequestPost({ request, env }) {
  try {
    // --- ENV & provider/signer
    const RPC_URL = env.RPC_URL || env.CRONOS_RPC_URL; // set in CF env
    const PK = env.EMPIRE_PK;                           // 🔐 set in CF env (never in frontend)
    if (!RPC_URL || !PK) return json({ error: "server config missing: RPC_URL/EMPIRE_PK" }, 500);

    const url = new URL(request.url);
    const to = getWalletLowerFromAny(request, url);     // user destination
    if (!to) return json({ error: "Missing or invalid wallet" }, 400);

    const { token, amount } = await request.json().catch(() => ({}));
    const sym = String(token || "").toUpperCase();
    if (!ALLOWED_TOKENS.has(sym)) return json({ error: `Token not allowed: ${sym}` }, 400);

    const amt = Number(amount);
    if (!(Number.isFinite(amt) && amt > 0)) return json({ error: "Invalid amount" }, 400);

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
      global: { headers: { "x-client-info": "crooks-backend" } },
    });

    const userId = await getOrCreateUserId(sb, to);
    const curBal = await getBalance(sb, userId, sym);
    if (curBal < amt) return json({ error: "Insufficient balance" }, 400);

    // --- send on-chain
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(PK, provider);

    let tx, decimals = 18;

    // token contract addresses mapping from env (JSON), e.g.
    // {"CRKS":"0xYourCrksToken","MOON":"0x...","BONE":"0x..."}
    const mapJson = env.TOKEN_ADDRESS_MAP || "{}";
    let tokenMap;
    try { tokenMap = JSON.parse(mapJson); } catch { tokenMap = {}; }

    if (sym === "CRO") {
      // native CRO
      const wei = ethers.parseEther(String(amt));
      tx = await signer.sendTransaction({ to, value: wei });
    } else {
      const ca = tokenMap[sym];
      if (!ca) return json({ error: `Missing token address for ${sym}` }, 500);
      const erc20 = new ethers.Contract(ca, ERC20_ABI, signer);
      try { decimals = Number(await erc20.decimals()); } catch {}
      const value = ethers.parseUnits(String(amt), decimals);
      tx = await erc20.transfer(to, value);
    }

    const rec = await tx.wait(); // 1 conf

    // --- deduct balance & store withdrawal record
    const newBal = await addLedgerAndSetBalance(sb, userId, sym, -amt);

    // optional: mirror in withdraw_requests with status=sent
    await sb.from("withdraw_requests").insert({
      user_id: userId,
      token_symbol: sym,
      amount: amt,
      to_address: to,
      status: "sent",
      note: "instant",
    });

    return json({
      ok: true,
      token: sym,
      amount: amt,
      to,
      tx_hash: tx.hash,
      new_balance: newBal,
      block_number: rec?.blockNumber ?? null,
    });
  } catch (e) {
    return json({ error: e?.message || "withdraw failed" }, 500);
  }
}
