// src/game/HeistEngine.js

export function runHeist(heistsData, heistKey, player) {
  const heist = heistsData.heists[heistKey];
  if (!heist) throw new Error("Unknown heist: " + heistKey);

  // Stamina check
  if (player.stamina < heist.stamina_cost) {
    return { success: false, type: "blocked", reason: "Not enough stamina" };
  }

  // Determine success (base chance; can depend on strength)
  const rec = Math.max(1, Number(heist.recommended_strength) || 1);
  const ratio = (Number(player.strength) || 0) / rec;
  const base = 0.40;
  const bonus = Math.min(0.45, ratio * 0.40);
  const successChance = Math.min(0.90, base + bonus);
  const success = rng() < successChance;

  // Spend stamina
  player.stamina -= heist.stamina_cost;

  if (!success) {
    const lostPoints = Math.round(randomBetween(heist.loss_points_if_fail));
    return {
      success: false,
      pointsChange: -lostPoints,
      staminaCost: heist.stamina_cost,
      message: pickRandom(heist.fail_msgs),
    };
  }

  // SUCCESS PATH
  const tokensWon = {};
  const tokenPool = heistsData.tokens_pool;
  const tokenCount = randomInt(heist.token_drops.min, heist.token_drops.max);
  const tokens = pickUnique(tokenPool, tokenCount);

  // Lucky bonus
  const lb = heistsData.lucky_bonus || { chance: 0, multiplier_range: [1, 1] };
  let lucky = false, luckyMultiplier = 1;
  if (rng() < (Number(lb.chance) || 0)) {
    lucky = true;
    luckyMultiplier = randomBetween(lb.multiplier_range);
  }

  // Rewards
  for (const token of tokens) {
    const usdBase = randomBetween(heist.amount_usd_range);
    const userMult = Number(player.multiplier || 1);
    const usd = usdBase * luckyMultiplier * userMult;
    const tokenValue = heistsData.token_values_usd[token];
    const amount = usd / tokenValue;
    const rounded = roundToken(token, amount, heistsData.token_rounding?.[token] ?? 2);
    tokensWon[token] = rounded;
  }

  const gainedPoints = Math.round(randomBetween(heist.points_if_success));

  // Message
  const tokenNames = Object.keys(tokensWon)
    .map(t => `${tokensWon[t]} ${t}`)
    .join(", ");
  const message = pickRandom(heist.success_msgs)
    .replace("{loot}", tokenNames)
    .replace("{token}", "");

  return {
    success: true,
    lucky,
    luckyMultiplier,
    pointsChange: gainedPoints,
    staminaCost: heist.stamina_cost,
    rewards: tokensWon,
    message,
  };
}

// === helpers ===
function randomBetween([min, max]) {
  return rng() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickUnique(arr, count) {
  const copy = [...arr];
  const result = [];
  while (result.length < count && copy.length > 0) {
    const idx = Math.floor(rng() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}

function roundToken(token, value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

// Cryptographically safer RNG
function rng() {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] / 2 ** 32;
}
