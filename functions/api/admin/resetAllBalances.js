import { json, supabase, isAdmin, ALLOWED_TOKENS } from "../../_lib/backend";

export const onRequestPost = async ({ request, env }) => {
  if (!isAdmin(request, env)) return json(request, { error: "forbidden" }, 403);
  const sb = supabase(env);

  let body = {};
  try { body = await request.json(); } catch {}
  const { token } = body || {};

  try {
    if (token) {
      const sym = String(token).toUpperCase();
      if (!ALLOWED_TOKENS.has(sym)) return json(request, { error: "Token not allowed" }, 400);
      const { error } = await sb.from("token_balances").update({ balance: 0 }).eq("token_symbol", sym);
      if (error) return json(request, { error: error.message }, 500);
      return json(request, { ok: true, reset: sym });
    } else {
      const { error } = await sb.from("token_balances").update({ balance: 0 });
      if (error) return json(request, { error: error.message }, 500);
      return json(request, { ok: true });
    }
  } catch (e) {
    return json(request, { error: e.message || "Reset failed" }, 500);
  }
};
