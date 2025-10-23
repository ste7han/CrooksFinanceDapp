// backend/server.mjs
// Minimal Crooks Empire API (Express + Postgres)
// - Auth (mock): X-Wallet-Address header (of Authorization: Bearer <wallet>)
// - Endpoints: /health, /heists, /me, /me/stamina, /me/balances, POST /me/heists/:key/play
// - Heist-engine server-side (fair RNG), transactie met ledger + balances + stamina

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pkg from 'pg';
import crypto from 'crypto';

const { Pool } = pkg;

// ---- Config ----
const PORT = process.env.PORT || 8787;
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL ontbreekt in .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Supabase
});

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// ---- Ranks & helpers (server authoritative) ----
const RANKS = [
  { id: 1,  name: "Prospect",       min: 0   },
  { id: 2,  name: "Member",         min: 1   },
  { id: 3,  name: "Hustler",        min: 2   },
  { id: 4,  name: "Street Soldier", min: 3   },
  { id: 5,  name: "Enforcer",       min: 5   },
  { id: 6,  name: "Officer",        min: 10  },
  { id: 7,  name: "Captain",        min: 25  },
  { id: 8,  name: "General",        min: 50  },
  { id: 9,  name: "Gang Leader",    min: 75  },
  { id: 10, name: "Boss",           min: 100 },
  { id: 11, name: "Kingpin",        min: 150 },
  { id: 12, name: "Overlord",       min: 200 },
  { id: 13, name: "Icon",           min: 300 },
  { id: 14, name: "Legend",         min: 400 },
  { id: 15, name: "Immortal",       min: 500 },
];

const STAMINA_CAP = {
  "Prospect": 0, "Member": 2, "Hustler": 4, "Street Soldier": 6, "Enforcer": 8,
  "Officer": 10, "Captain": 12, "General": 14, "Gang Leader": 16, "Boss": 18,
  "Kingpin": 18, "Overlord": 19, "Icon": 19, "Legend": 20, "Immortal": 20
};

function rankAtLeast(cur, need) {
  const norm = s => String(s||'').trim().toLowerCase();
  const a = RANKS.find(r => norm(r.name) === norm(cur))?.id ?? -1;
  const b = RANKS.find(r => norm(r.name) === norm(need))?.id ?? 9999;
  return a >= b;
}
const staminaCapFor = (name) => STAMINA_CAP[name] ?? 0;

// cryptographically-strong RNG in [0,1)
function rng() {
  const buf = crypto.randomBytes(4);
  return buf.readUInt32BE(0) / 2**32;
}
const randomBetween = ([min, max]) => rng() * (max - min) + min;
const randomInt = (a, b) => Math.floor(rng() * (b - a + 1)) + a;
const round = (n, d=2) => Math.round(n * 10**d) / 10**d;

// ---- Auth (mock) ----
// Accept either header "X-Wallet-Address: 0x..." or "Authorization: Bearer 0x..."
// Ensures user exists in DB and attaches req.user = { id, wallet_address }
app.use(async (req, res, next) => {
  try {
    let wallet = req.header('X-Wallet-Address');
    if (!wallet) {
      const auth = req.header('Authorization') || '';
      const m = auth.match(/^Bearer\s+(.+)/i);
      if (m) wallet = m[1];
    }
    if (!wallet) return res.status(401).json({ error: 'Missing wallet header' });

    wallet = wallet.trim();
    // upsert user
    const { rows } = await pool.query(
      `insert into users (wallet_address) values ($1)
       on conflict (wallet_address) do update set last_login_at = now()
       returning id, wallet_address`,
      [wallet]
    );
    req.user = rows[0];

    // ensure stamina row exists with cap from (optional) rank_name header if sent
    const rankNameHeader = req.header('X-Rank-Name') || 'Prospect';
    const cap = staminaCapFor(rankNameHeader);
    await pool.query(
      `insert into stamina_states (user_id, stamina, cap, last_tick_at)
       values ($1, $2, $3, now())
       on conflict (user_id) do nothing`,
      [req.user.id, cap, cap]
    );

    next();
  } catch (e) {
    console.error('[auth]', e);
    res.status(500).json({ error: 'Auth failed' });
  }
});

// ---- Routes ----
app.get('/health', (req, res) => res.json({ ok: true }));

// All heists from DB
app.get('/heists', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      select
        key as id,
        title,
        min_role,
        stamina_cost,
        recommended_strength,
        token_drops_min,
        token_drops_max,
        amount_usd_min::float as amount_usd_min,
        amount_usd_max::float as amount_usd_max,
        points_min,
        points_max,
        difficulty
      from heists
      order by stamina_cost, title;
    `);
    res.json({ heists: rows });
  } catch (e) {
    console.error('[heists]', e);
    res.status(500).json({ error: 'Failed to load heists' });
  }
});


// Me & quick snapshots
app.get('/me', (req, res) => {
  res.json({ id: req.user.id, wallet: req.user.wallet_address });
});

app.get('/me/stamina', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select user_id, stamina, cap, last_tick_at, updated_at
       from stamina_states where user_id=$1`,
      [req.user.id]
    );
    res.json(rows[0] || null);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load stamina' });
  }
});

app.get('/me/balances', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `select token_symbol, balance, updated_at
       from token_balances where user_id=$1
       order by token_symbol`, [req.user.id]
    );
    res.json({ balances: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load balances' });
  }
});

// ---- Heist Engine (server copy; values come from DB masterdata) ----
function computeHeistOutcome(heist, player) {
  // rank gate
  if (!rankAtLeast(player.rankName || 'Prospect', heist.min_role)) {
    return { blocked: true, reason: `Requires rank ${heist.min_role}+` };
  }
  if ((player.stamina||0) < heist.stamina_cost) {
    return { blocked: true, reason: 'Not enough stamina' };
  }

  // success chance scales with strength vs. recommended
  const rec = Math.max(1, Number(heist.recommended_strength) || 1);
  const ratio = (Number(player.strength) || 0) / rec;
  const base = 0.40;
  const bonus = Math.min(0.45, ratio * 0.40);
  const successChance = Math.min(0.90, base + bonus);
  const success = rng() < successChance;

  if (!success) {
    const lostPoints = Math.round(randomBetween([heist.points_min/2, heist.points_min])); // conservatief
    return {
      success: false,
      pointsChange: -lostPoints,
      staminaCost: heist.stamina_cost,
      rewards: {},
      lucky: false,
      luckyMultiplier: 1,
      message: 'The job went sideways. You slipped out with nothing.'
    };
  }

  // rewards: select distinct tokens from global pool; we read from prices-like map later; for now even odds
  // Server kent geen tokens_pool hier; we crediten standaard CRKS (kan je uitbreiden met prijzen-tabel)
  const drops = randomInt(heist.token_drops_min, heist.token_drops_max);
  const rewards = { CRKS: 0 };

  // Lucky bonus simplistisch
  const lucky = rng() < 0.10; // 10%
  const luckyMultiplier = lucky ? randomBetween([1.5, 3.0]) : 1;

  // USD → token units: we nemen 1 CRKS = $0.01 als placeholder; zet later prijzen in `prices` tabel
  const px = 0.01;
  for (let i=0;i<drops;i++) {
    const usd = randomBetween([heist.amount_usd_min, heist.amount_usd_max]) * (player.multiplier || 1) * luckyMultiplier;
    rewards.CRKS += usd / px;
  }
  rewards.CRKS = round(rewards.CRKS, 2);

  const points = Math.round(randomBetween([heist.points_min, heist.points_max]));

  return {
    success: true,
    pointsChange: points,
    staminaCost: heist.stamina_cost,
    rewards,
    lucky,
    luckyMultiplier,
    message: `Clean getaway. Loot: ${rewards.CRKS} CRKS`,
  };
}

// ---- POST /me/heists/:key/play ----
// Body verwacht: { strength: number, multiplier: number, rankName: string }
app.post('/me/heists/:key/play', async (req, res) => {
  const heistKey = req.params.key;
  const { strength=0, multiplier=1, rankName='Prospect' } = req.body || {};
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1) Haal heist + stamina FOR UPDATE
    const heistQ = await client.query(
      `select * from heists where key=$1`,
      [heistKey]
    );
    if (heistQ.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Unknown heist' });
    }
    const heist = heistQ.rows[0];

    const stamQ = await client.query(
      `select user_id, stamina, cap, last_tick_at from stamina_states where user_id=$1 for update`,
      [req.user.id]
    );
    const stam = stamQ.rows[0] || { stamina: 0, cap: 0 };

    const outcome = computeHeistOutcome(heist, { stamina: stam.stamina, strength, multiplier, rankName });

    if (outcome.blocked) {
      await client.query('ROLLBACK');
      return res.status(400).json({ blocked: true, message: outcome.reason });
    }

    // 2) Update stamina
    const newStamina = Math.max(0, (stam.stamina || 0) - (outcome.staminaCost || 0));
    await client.query(
      `update stamina_states set stamina=$1, last_tick_at=now(), updated_at=now() where user_id=$2`,
      [newStamina, req.user.id]
    );

    // 3) Log heist_run
    const seed = crypto.randomBytes(8).toString('hex');
    const runIns = await client.query(
      `insert into heist_runs
         (user_id, heist_key, success, points_change, stamina_cost, rewards_json, lucky, lucky_multiplier, player_strength, player_multiplier, rng_seed)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       returning id`,
      [
        req.user.id,
        heist.key,
        outcome.success,
        outcome.pointsChange,
        outcome.staminaCost,
        JSON.stringify(outcome.rewards),
        outcome.lucky,
        outcome.luckyMultiplier,
        Math.round(Number(strength)||0),
        Number(multiplier)||1,
        seed
      ]
    );
    const runId = runIns.rows[0].id;

    // 4) Ledger + balances (alleen als success en rewards > 0)
    if (outcome.success) {
      for (const [sym, amt] of Object.entries(outcome.rewards)) {
        const n = Number(amt) || 0;
        if (n <= 0) continue;

        await client.query(
          `insert into token_ledger (user_id, token_symbol, amount, reason, ref_id)
           values ($1, $2, $3, 'heist_reward', $4)`,
          [req.user.id, sym, n, runId]
        );

        await client.query(
          `insert into token_balances (user_id, token_symbol, balance)
           values ($1, $2, $3)
           on conflict (user_id, token_symbol) do update
           set balance = token_balances.balance + excluded.balance,
               updated_at = now()`,
          [req.user.id, sym, n]
        );
      }
    }

    await client.query('COMMIT');

    // response payload
    return res.json({
      success: outcome.success,
      message: outcome.message,
      points: outcome.pointsChange,
      rewards: outcome.rewards,
      lucky: outcome.lucky,
      luckyMultiplier: outcome.luckyMultiplier,
      staminaCost: outcome.staminaCost,
      staminaAfter: newStamina,
      runId
    });

  } catch (e) {
    console.error('[play]', e);
    try { await client.query('ROLLBACK'); } catch {}
    res.status(500).json({ error: 'Play failed' });
  } finally {
    client.release();
  }
});

// ---- Start server ----
app.listen(PORT, () => {
  console.log(`Crooks API listening on http://localhost:${PORT}`);
});
