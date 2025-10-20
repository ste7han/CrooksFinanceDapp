// src/lib/empireRules.js
export const POINTS = {
  HEIST_WIN: 25,
  HEIST_LOSS: 5,
  CLAIM_PER_MOON: 0.1,      // 0.1 faction point per MOON claimed
  CLAIM_PER_CRKS: 0.02,     // 0.02 point per CRKS claimed (if you award CRKS somewhere)
  CRKL_HOLDING_BONUS: (crklCount) => Math.min(100, Math.floor(crklCount * 0.2)), // up to +100 weekly
};

export function pointsFromHeist(result) {
  return result === "win" ? POINTS.HEIST_WIN : POINTS.HEIST_LOSS;
}

export function pointsFromClaim({ moon = 0, crks = 0 }) {
  return (moon * POINTS.CLAIM_PER_MOON) + (crks * POINTS.CLAIM_PER_CRKS);
}
