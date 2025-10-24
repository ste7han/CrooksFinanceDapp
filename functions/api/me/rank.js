import { json, supabase, getWalletLower, getOrCreateUserId } from "../../../functions/_lib/backend.js";

const VALID_RANKS = new Set([
  "Prospect","Member","Hustler","Street Soldier","Enforcer","Officer",
  "Captain","General","Gang Leader","Boss","Kingpin","Overlord",
  "Icon","Legend","Immortal"
]);

export const onRequestPost = async ({ request, env }) => {
  const wallet = getWalletLower(request);
  if (!wallet) return json(request, { error: "Missing or invalid wallet" }, 400);

  let body = {};
  try { body = await request.json(); } catch {}
  const rank = String(body?.rank_name || "").trim();
  if (!VALID_RANKS.has(rank)) return json(request, { error: "Invalid rank_name" }, 400);

  const sb = supabase(env);
  try {
    const userId = await getOrCreateUserId(sb, wallet);
    const up = await sb.from("profiles").upsert({ user_id: userId, rank_name: rank }, { onConflict: "user_id" });
    if (up.error) return json(request, { error: up.error.message }, 500);
    return json(request, { ok: true, wallet, user_id: userId, rank_name: rank });
  } catch (e) {
    return json(request, { error: e.message || "rank upsert failed" }, 500);
  }
};
