import { json, supabase, isAdmin, getOrCreateUserId } from "../../_lib/backend";

export const onRequestPost = async ({ request, env }) => {
  if (!isAdmin(request, env)) return json(request, { error: "forbidden" }, 403);
  const sb = supabase(env);

  let body = {};
  try { body = await request.json(); } catch {}
  const { wallet, delta } = body;
  if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) return json(request, { error: "Invalid wallet" }, 400);

  try {
    const lower = wallet.toLowerCase();
    const userId = await getOrCreateUserId(sb, lower);

    const { data: cur, error: e1 } = await sb
      .from("stamina_states")
      .select("stamina,cap")
      .eq("user_id", userId)
      .single();
    if (e1 && e1.code !== "PGRST116") return json(request, { error: e1.message }, 500);

    const add = Number(delta) || 0;
    const cap = Number(cur?.cap || 0);
    const curStam = Number(cur?.stamina || 0);

    let next = curStam + add;
    if (cap > 0) next = Math.min(next, cap);
    if (next < 0) next = 0;

    const payload = {
      user_id: userId, stamina: next, cap: cap || (cur ? cap : 0),
      last_tick_at: new Date().toISOString(),
    };
    const { error: e2 } = await sb.from("stamina_states")
      .upsert(payload, { onConflict: "user_id" });
    if (e2) return json(request, { error: e2.message }, 500);

    return json(request, { ok: true, wallet: lower, stamina: next, cap: payload.cap });
  } catch (e) {
    return json(request, { error: e.message || "Grant stamina failed" }, 500);
  }
};
