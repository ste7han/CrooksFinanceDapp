// functions/_lib/staminaCaps.js
// Source of truth based on your config (updated_at: 2025-10-19)
export const RANK_CAPS = {
  "Prospect": 0,
  "Member": 2,
  "Hustler": 4,
  "Street Soldier": 6,
  "Enforcer": 8,
  "Officer": 10,
  "Captain": 12,
  "General": 14,
  "Gang Leader": 16,
  "Boss": 18,
  "Kingpin": 18,
  "Overlord": 19,
  "Icon": 19,
  "Legend": 20,
  "Immortal": 20,
};

export function getCapForRank(rankName) {
  // Fallback to "Prospect" (0) if unknown
  return Object.prototype.hasOwnProperty.call(RANK_CAPS, rankName)
    ? RANK_CAPS[rankName]
    : RANK_CAPS["Prospect"];
}
