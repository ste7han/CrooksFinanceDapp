import {
  json, supabase, isAdmin, ALLOWED_TOKENS,
  getOrCreateUserId, addLedgerAndUpsertBalanceByUserId
} from "../../_lib/backend";

export const onRequestPost = async ({ request, env }) => {
  if (!isAdmin(request, env)) return json(request, { error: "forbidden" }, 403);
  const sb = supabase(env);

  let body = {};
  try { body = await request.json(); } catch {}
  const { wallet, token, amount } = body;

  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json(request, { error: "Invalid wallet" }, 400);
  const sym = String(token || "").toUpperCase();
  if (!ALLOWED_TOKENS.has(sym)) return json(request, { error: "Token not allowed" }, 400);
  const delta = Number(amount);
  if (!Number.isFinite(delta)) return json(request, { error: "Invalid amount" }, 400);

  try {
    const userId = await getOrCreateUserId(sb, wallet.toLowerCase());
    const newBal = await addLedgerAndUpsertBalanceByUserId(sb, userId, sym, delta, "admin_add", null);
    return json(request, { ok: true, wallet: wallet.toLowerCase(), token: sym, balance: newBal });
  } catch (e) {
    return json(request, { error: e.message || "Add funds failed" }, 500);
  }
};
