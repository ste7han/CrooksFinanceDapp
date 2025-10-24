import { json, supabase, isAdmin, getOrCreateUserId } from "../../_lib/backend";
import { getCapForRank } from "../../_lib/staminaCaps";
import { getRankNameForUser } from "../../_lib/rankLookup";

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

    // Get rank → cap
    const rankName = await getRankNameForUser(sb, userId);
    const cap = getCapForRank(rankName);

    // Load current stamina row (may not exist)
    const sel = await sb
      .from("stamina_states")
      .select("stamina,cap")
      .eq("user_id", userId)
      .single();
    if (sel.error && sel.error.code !== "PGRST116") return json(request, { error: sel.error.message }, 500);

    const curStam = Number(sel.data?.stamina || 0);
    const add = Number(delta) || 0;

    // Apply delta and clamp to rank cap (cap can be 0 for Prospect)
    let next = curStam + add;
    if (cap > 0) next = Math.min(next, cap);
    if (next < 0) next = 0;

    const payload = {
      user_id: userId,
      stamina: next,
      cap, // always set the DB cap to the rank-derived cap
      last_tick_at: new Date().toISOString(),
    };
    const up = await sb.from("stamina_states").upsert(payload, { onConflict: "user_id" });
    if (up.error) return json(request, { error: up.error.message }, 500);

    return json(request, { ok: true, wallet: lower, rank: rankName, stamina: next, cap });
  } catch (e) {
    return json(request, { error: e.message || "Grant stamina failed" }, 500);
  }
};
