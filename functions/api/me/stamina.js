import { json, supabase, getWalletLower, getOrCreateUserId } from "../../../functions/_lib/backend.js";

export const onRequestGet = async ({ request, env }) => {
  const wallet = getWalletLower(request);
  if (!wallet) return json(request, { error: "Missing or invalid wallet" }, 400);
  const sb = supabase(env);

  try {
    const userId = await getOrCreateUserId(sb, wallet);
    const { data, error } = await sb
      .from("stamina_states")
      .select("stamina,cap,updated_at,last_tick_at")
      .eq("user_id", userId)
      .single();

    // If no row yet, report zeros
    if (error && error.code === "PGRST116") {
      return json(request, { wallet, user_id: userId, stamina: 0, cap: 0, fresh: true });
    }
    if (error) return json(request, { error: error.message }, 500);

    return json(request, { wallet, user_id: userId, ...data });
  } catch (e) {
    return json(request, { error: e.message || "stamina fetch failed" }, 500);
  }
};
