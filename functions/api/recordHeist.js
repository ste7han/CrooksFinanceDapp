import { json, supabaseAdmin } from "./_lib/backend.js";

export async function onRequestPost(context) {
  const env = context.env;
  const supa = supabaseAdmin(env);
  const wallet = context.request.headers.get("X-Wallet-Address")?.toLowerCase();

  if (!wallet) return json({ error: "Missing X-Wallet-Address" }, 400);

  const body = await context.request.json().catch(() => ({}));
  const { success = false, points = 0, staminaCost = 0, heistKey = null } = body;

  // Find or create user
  let { data: user } = await supa
    .from("users")
    .select("id")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (!user) {
    const { data: newUser } = await supa
      .from("users")
      .insert({ wallet_address: wallet })
      .select()
      .maybeSingle();
    user = newUser;
  }

  const { error } = await supa.from("heist_runs").insert({
    user_id: user.id,
    wallet_address: wallet,
    success,
    points,
    stamina_cost: staminaCost,
    heist_key: heistKey,
  });

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
