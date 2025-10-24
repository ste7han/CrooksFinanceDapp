import { json, supabase, getWalletLower, getOrCreateUserId } from "../../../functions/_lib/backend.js";
import { getCapForRank } from "../../../functions/_lib/staminaCaps.js";
import { getRankNameForUser } from "../../../functions/_lib/rankLookup.js";

export const onRequestGet = async ({ request, env }) => {
  const wallet = getWalletLower(request);
  if (!wallet) return json(request, { error: "Missing or invalid wallet" }, 400);
  const sb = supabase(env);

  try {
    const userId = await getOrCreateUserId(sb, wallet);

    // 1) Resolve current rank from DB
    const rankName = await getRankNameForUser(sb, userId);
    const capFromRank = getCapForRank(rankName);

    // 2) Fetch stamina row
    const sel = await sb
      .from("stamina_states")
      .select("stamina,cap,updated_at,last_tick_at")
      .eq("user_id", userId)
      .single();

    // Row missing → create with cap from rank
    if (sel.error && sel.error.code === "PGRST116") {
      const payload = {
        user_id: userId,
        stamina: 0,
        cap: capFromRank,
        last_tick_at: new Date().toISOString(),
      };
      const up = await sb.from("stamina_states").upsert(payload, { onConflict: "user_id" });
      if (up.error) return json(request, { error: up.error.message }, 500);
      return json(request, {
        wallet, user_id: userId, rank: rankName, stamina: 0, cap: capFromRank, fresh: true
      });
    }

    if (sel.error) return json(request, { error: sel.error.message }, 500);

    // 3) If cap in DB mismatches the rank cap, heal it (and clamp stamina)
    const current = sel.data || {};
    let stamina = Number(current.stamina || 0);
    if (current.cap !== capFromRank) {
      stamina = Math.min(stamina, capFromRank);
      const up = await sb
        .from("stamina_states")
        .upsert({ user_id: userId, stamina, cap: capFromRank }, { onConflict: "user_id" });
      if (up.error) return json(request, { error: up.error.message }, 500);
    }

    return json(request, {
      wallet, user_id: userId, rank: rankName, stamina, cap: capFromRank,
      updated_at: current.updated_at, last_tick_at: current.last_tick_at
    });
  } catch (e) {
    return json(request, { error: e.message || "stamina fetch failed" }, 500);
  }
};
