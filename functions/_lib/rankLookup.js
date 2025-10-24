// functions/_lib/rankLookup.js
// Tries common places you might store rank. Adjust table/column names if needed.
export async function getRankNameForUser(sb, userId) {
  // Try 'profiles.rank_name'
  let q = await sb.from("profiles").select("rank_name").eq("user_id", userId).single();
  if (!q.error && q.data?.rank_name) return q.data.rank_name;

  // Try 'empire_profiles.rank_name'
  q = await sb.from("empire_profiles").select("rank_name").eq("user_id", userId).single();
  if (!q.error && q.data?.rank_name) return q.data.rank_name;

  // Fallback
  return "Prospect";
}

export async function getRankAndCapForUser(sb, userId) {
  const q = await sb.from("v_user_rank_cap").select("rank_name,stamina_cap").eq("user_id", userId).single();
  if (q.error) return { rankName: "Prospect", cap: 0 };
  return { rankName: q.data.rank_name, cap: Number(q.data.stamina_cap || 0) };
}

