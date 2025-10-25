import { json, supabaseAdmin } from "../_lib/backend.js";

export async function onRequestPost(context) {
  const env = context.env;
  const supa = supabaseAdmin(env);
  const wallet = context.request.headers.get("X-Wallet-Address")?.toLowerCase();

  if (!wallet) return json({ error: "Missing X-Wallet-Address" }, 400);

  const body = await context.request.json().catch(() => ({}));
  const { points = 0, faction = "neutral" } = body;

  const { error } = await supa
    .from("faction_points_totals")
    .upsert(
      {
        wallet_address: wallet,
        points,
        faction,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet_address" }
    );

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
}
