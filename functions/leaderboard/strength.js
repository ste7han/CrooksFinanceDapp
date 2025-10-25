import { json, supabaseAdmin } from "../_lib/backend.js";

export async function onRequestGet(context) {
  const db = supabaseAdmin(context.env);
  const { data, error } = await db.rpc("leaderboard_strength"); // optional SQL view
  if (error) return json(context, { error: error.message }, 500);
  return json(context, data);
}
