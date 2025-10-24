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
