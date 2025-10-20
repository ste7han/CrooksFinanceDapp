const API_BASE = import.meta.env.VITE_BRIDGE_URL || "http://localhost:8000";
const API_KEY  = import.meta.env.VITE_BRIDGE_KEY || ""; // matches API_KEY env

async function j<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export const bridge = {
  profileByWallet: (wallet: string) => j(`/api/profile/${wallet}`),
  setFaction: (wallet: string, faction: string) =>
    j(`/api/profile/${wallet}/faction`, { method: "PATCH", body: JSON.stringify({ faction }) }),
  addPoints: (wallet: string, scope: "week" | "month", points: number) =>
    j(`/api/profile/${wallet}/points`, { method: "POST", body: JSON.stringify({ scope, points }) }),
  factionLeaderboard: (scope: "week" | "month" = "week") =>
    j(`/api/leaderboard/factions?scope=${scope}`),
};
