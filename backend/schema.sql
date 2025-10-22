-- ======================================
-- Crooks Empire — Full Database Schema (PostgreSQL)
-- ======================================

-- ---------- USERS & AUTH ----------
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  wallet_address  TEXT UNIQUE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);

-- Nonce storage for wallet signature (login challenge)
CREATE TABLE IF NOT EXISTS auth_nonces (
  id             BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  nonce          TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_nonces_wallet ON auth_nonces(wallet_address);

-- ---------- PROFILE / FACTION / RANK SNAPSHOT ----------
CREATE TABLE IF NOT EXISTS profiles (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  faction_id TEXT,
  rank_name  TEXT,
  rank_id    INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- STAMINA (SERVER-AUTHORITATIVE) ----------
CREATE TABLE IF NOT EXISTS stamina_states (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stamina      INT NOT NULL DEFAULT 0,
  cap          INT NOT NULL DEFAULT 0,
  last_tick_at TIMESTAMPTZ NOT NULL DEFAULT now(), -- for regen cadence
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- HEISTS MASTERDATA ----------
CREATE TABLE IF NOT EXISTS heists (
  key                   TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  min_role              TEXT NOT NULL,
  stamina_cost          INT  NOT NULL,
  recommended_strength  INT  NOT NULL,
  token_drops_min       INT  NOT NULL,
  token_drops_max       INT  NOT NULL,
  amount_usd_min        NUMERIC(18,6) NOT NULL,
  amount_usd_max        NUMERIC(18,6) NOT NULL,
  points_min            INT  NOT NULL,
  points_max            INT  NOT NULL,
  difficulty            TEXT
);

-- ---------- HEIST RUNS (AUDIT LOG) ----------
CREATE TABLE IF NOT EXISTS heist_runs (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  heist_key         TEXT   NOT NULL REFERENCES heists(key),
  success           BOOLEAN NOT NULL,
  points_change     INT     NOT NULL,
  stamina_cost      INT     NOT NULL,
  rewards_json      JSONB   NOT NULL DEFAULT '{}', -- {CRKS:1.23, MOON:0.5, ...}
  lucky             BOOLEAN NOT NULL DEFAULT FALSE,
  lucky_multiplier  NUMERIC(10,4) NOT NULL DEFAULT 1,
  -- extra observability for fairness/debugging
  player_strength   INT,
  player_multiplier NUMERIC(10,4) DEFAULT 1,
  rng_seed          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_heist_runs_user  ON heist_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_heist_runs_heist ON heist_runs(heist_key);

-- ---------- TOKEN LEDGER (IMMUTABLE EVENTS) ----------
CREATE TABLE IF NOT EXISTS token_ledger (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_symbol  TEXT   NOT NULL,                       -- e.g. CRKS, MOON, ...
  amount        NUMERIC(38,18) NOT NULL,               -- positive or negative
  reason        TEXT   NOT NULL,                       -- 'heist_reward' | 'payout' | 'adjust' | ...
  ref_id        BIGINT,                                -- e.g. heist_runs.id or withdraw_requests.id
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_token_ledger_user_token ON token_ledger(user_id, token_symbol);

-- ---------- TOKEN BALANCES (DENORMALIZED FAST PATH) ----------
CREATE TABLE IF NOT EXISTS token_balances (
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_symbol TEXT   NOT NULL,
  balance      NUMERIC(38,18) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token_symbol)
);

-- ---------- WITHDRAW REQUESTS ----------
CREATE TABLE IF NOT EXISTS withdraw_requests (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_symbol  TEXT   NOT NULL,
  amount        NUMERIC(38,18) NOT NULL,
  to_address    TEXT   NOT NULL,
  note          TEXT,
  status        TEXT   NOT NULL DEFAULT 'queued',  -- queued|processing|paid|declined
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_withdraw_user ON withdraw_requests(user_id);

-- ---------- FACTION POINTS (EVENTS LEDGER) ----------
CREATE TABLE IF NOT EXISTS faction_points_ledger (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  faction_id TEXT   NOT NULL,
  points     INT    NOT NULL,
  reason     TEXT   NOT NULL,        -- 'heist_success' | 'adjust' | ...
  ref_id     BIGINT,                 -- e.g. heist_runs.id
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- (optional) denormalized totals for fast leaderboards
CREATE TABLE IF NOT EXISTS faction_points_totals (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope       TEXT   NOT NULL,       -- 'week' | 'month' | 'all'
  points      INT    NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope)
);

-- ---------- USER LINKS (DISCORD, ETC.) ----------
CREATE TABLE IF NOT EXISTS user_links (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  discord_id TEXT UNIQUE
);

-- ---------- PRICES CACHE (OPTIONAL) ----------
CREATE TABLE IF NOT EXISTS prices (
  token_symbol TEXT PRIMARY KEY,
  usd          NUMERIC(18,6) NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- IDEMPOTENCY KEYS (PREVENT DUPLICATE SUBMITS) ----------
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key        TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- RECOMMENDED VIEWS (OPTIONAL) ----------
-- Current balances joined with user wallet (handy for admin dashboards)
CREATE OR REPLACE VIEW v_user_balances AS
SELECT u.wallet_address, b.token_symbol, b.balance, b.updated_at
FROM token_balances b
JOIN users u ON u.id = b.user_id;

-- Aggregate faction totals by scope (if you use the ledger-only approach)
-- (Example weekly agg; adapt scheduling to your cron/worker)
-- SELECT user_id, SUM(points) FROM faction_points_ledger WHERE created_at >= date_trunc('week', now()) GROUP BY 1;

-- ---------- BASIC CHECKS (OPTIONAL, SAFE DEFAULTS) ----------
-- Ensure no negative balances are stored accidentally (server should prevent this).
-- You can enforce with a constraint if you prefer hard-fail writes:
-- ALTER TABLE token_balances ADD CONSTRAINT chk_balance_nonneg CHECK (balance >= 0);
