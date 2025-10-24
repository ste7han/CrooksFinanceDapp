import { json, supabase, isAdmin, ALLOWED_TOKENS, getOrCreateUserId } from "../../_lib/backend";

export const onRequestPost = async ({ request, env }) => {
  if (!isAdmin(request, env)) return json(request, { error: "forbidden" }, 403);
  const sb = supabase(env);

  let body = {};
  try { body = await request.json(); } catch {}
  const { wallet, token } = body;
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json(request, { error: "Invalid wallet" }, 400);

  try {
    const lower = wallet.toLowerCase();
    const userId = await getOrCreateUserId(sb, lower);

    if (token) {
      const sym = String(token).toUpperCase();
      if (!ALLOWED_TOKENS.has(sym)) return json(request, { error: "Token not allowed" }, 400);
      const { error } = await sb
        .from("token_balances")
        .upsert({ user_id: userId, token_symbol: sym, balance: 0 }, { onConflict: "user_id,token_symbol" });
      if (error) return json(request, { error: error.message }, 500);
    } else {
      const { error } = await sb.from("token_balances").update({ balance: 0 }).eq("user_id", userId);
      if (error) return json(request, { error: error.message }, 500);
    }
    return json(request, { ok: true, wallet: lower });
  } catch (e) {
    return json(request, { error: e.message || "Reset failed" }, 500);
  }
};
