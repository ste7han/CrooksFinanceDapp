// src/pages/EmpireHeists.jsx
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import heistsData from "../data/heists.json";
import { runHeist } from "../game/heistEngine.js";
import { useWallet } from "../context/WalletContext";
import { useEmpire } from "../context/EmpireContext";

// ===== Styling helpers =====
const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const SOFT = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const BTN = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_GHOST = `${BTN} bg-white/8 hover:bg-white/14 border border-white/12`;
const BTN_PRIMARY = `${BTN} bg-emerald-500 text-black hover:bg-emerald-400`;

// ===== Contracts (Cronos) =====
const CRKL_NFT_ADDRESS = (import.meta.env.VITE_CRKL_NFT_ADDRESS ||
  "0x44102b7ab3e2b8edf77d188cd2b173ecbda60967").trim();

const WEAPON_NFT_ADDRESS = (import.meta.env.VITE_WEAPON_NFT_ADDRESS ||
  "0xB09b903403775Ac0e294B845bF157Bd6A5e8e329").trim();

const CRKS_ADDRESS = (import.meta.env.VITE_CRKS_CA || "").trim();

const ERC721_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns(uint256)",
  "function supportsInterface(bytes4) view returns(bool)",
  "function tokenURI(uint256) view returns(string)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// === Backend ===
const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL || "https://crooks-backend.steph-danser.workers.dev").replace(/\/$/, "");
async function apiFetch(path, { method = "GET", body, wallet } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (wallet) headers.Authorization = `Bearer ${wallet}`;
  const r = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error || `Request failed: ${r.status}`);
  return j;
}

// ===== Rank thresholds (NFT count → rank name) =====
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

function computeRank(crklCount) {
  let current = RANKS[0];
  for (const r of RANKS) if (crklCount >= r.min) current = r;
  const next = RANKS.find(r => r.min > current.min) || null;
  return { current, next };
}
function rankAtLeast(currentName, needName) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const curId  = RANKS.find(r => norm(r.name) === norm(currentName))?.id ?? -1;
  const needId = RANKS.find(r => norm(r.name) === norm(needName))?.id ?? 9999;
  return curId >= needId;
}

// ===== Heist images =====
const HEIST_IMG = (k) => `/pictures/heists/${k}.png`;
const FALLBACK_IMG = "/pictures/heists/_placeholder.png";

// ===== Small helpers =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function resolveMediaUrl(u) {
  if (!u) return null;
  if (u.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + u.replace("ipfs://", "");
  if (u.startsWith("ar://")) return `https://arweave.net/${u.slice(5)}`;
  return u;
}
async function fetchJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}
function parseStrength(meta) {
  if (!meta) return 0;
  const attrs = meta.attributes || meta.traits || [];
  const hit = attrs.find(
    (a) =>
      String(a?.trait_type || a?.type || "").toLowerCase() === "strength" ||
      String(a?.trait_type || a?.type || "").toLowerCase() === "power"
  );
  let v = hit?.value ?? meta.strength ?? meta.power ?? 0;
  if (typeof v === "string") v = v.replace(/[^\d.]/g, "");
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
const round = (n, d=2) => Math.round(n * 10**d) / 10**d;
const randBetween = ([a,b]) => Math.random() * (b - a) + a;
const randInt = (a,b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function formatInt(n) { const x = Number(n || 0); return Number.isFinite(x) ? x.toLocaleString() : "0"; }
const fmtETA = (ms) => {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  return `${m}:${ss}`;
};

export default function EmpireHeists() {
  const { provider, address, networkOk } = useWallet();

  const {
    state: empire,              // legacy local stats (played/wins/losses, etc.)
    // backend-authoritative stamina
    stamina,
    staminaCap,
    nextTickMs,
    refreshStamina,
    // keep using these
    setStamina,                 // local shadow; we still decrement instantly for UX
    awardTokens,
    recordHeist,
    hydrateFromWallet,
  } = useEmpire();

  // hydrate identity for persistence later
  useEffect(() => { if (address) hydrateFromWallet(address); }, [address, hydrateFromWallet]);

  // ✅ pull stamina/cap/ETA from backend and keep it in sync
  useEffect(() => {
    refreshStamina().catch(() => {});
    const id = setInterval(() => refreshStamina().catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, [refreshStamina]);

  const [readProvider, setReadProvider] = useState(null);
  useEffect(() => {
    if (provider) setReadProvider(provider);
    else setReadProvider(new ethers.JsonRpcProvider("https://evm.cronos.org"));
  }, [provider]);

  // On-chain reads for Rank (CRKL), Multiplier (CRKS), Weapons Strength & Count
  const [crklCount, setCrklCount] = useState(0);
  const [crksHuman, setCrksHuman] = useState(0);
  const [weaponsCount, setWeaponsCount] = useState(0);
  const [totalStrength, setTotalStrength] = useState(0);

  // Contracts
  const crkl = useMemo(() => (readProvider ? new ethers.Contract(CRKL_NFT_ADDRESS, ERC721_ABI, readProvider) : null), [readProvider]);
  const weapons = useMemo(() => (readProvider ? new ethers.Contract(WEAPON_NFT_ADDRESS, ERC721_ABI, readProvider) : null), [readProvider]);

  useEffect(() => { (async () => {
    if (!crkl || !address) return;
    try {
      const bal = await crkl.balanceOf(address).catch(() => 0n);
      setCrklCount(Number(bal || 0n));
    } catch {}
  })(); }, [crkl, address]);

  useEffect(() => { (async () => {
    if (!readProvider || !address || !CRKS_ADDRESS) return;
    try {
      const c = new ethers.Contract(CRKS_ADDRESS, ERC20_ABI, readProvider);
      const [bal, dec] = await Promise.all([
        c.balanceOf(address).catch(() => 0n),
        c.decimals().catch(() => 18),
      ]);
      const human = Number(ethers.formatUnits(bal, Number(dec || 18)));
      setCrksHuman(Number.isFinite(human) ? human : 0);
    } catch {}
  })(); }, [readProvider, address]);

  useEffect(() => { (async () => {
    if (!weapons || !address) return;
    try {
      const ENUM_ID = "0x780e9d63";
      const enumerable = await weapons.supportsInterface(ENUM_ID).catch(() => false);
      if (!enumerable) { setWeaponsCount(0); setTotalStrength(0); return; }

      const bal = await weapons.balanceOf(address);
      const n = Number(bal || 0n);
      setWeaponsCount(n);

      let sum = 0;
      for (let i = 0; i < n; i++) {
        const id = await weapons.tokenOfOwnerByIndex(address, i);
        let meta = null;
        try {
          const uri = await weapons.tokenURI(id);
          const url = resolveMediaUrl(uri);
          if (url) meta = await fetchJson(url);
        } catch {}
        if (!meta) meta = await fetchJson(`/metadata_weapons/${Number(id)}.json`);
        sum += parseStrength(meta);
        await sleep(40);
      }
      setTotalStrength(sum);
    } catch {
      setWeaponsCount(0);
      setTotalStrength(0);
    }
  })(); }, [weapons, address]);

  // Derived stats from on-chain & context
  const { current: currentRank } = computeRank(crklCount);
  const bonusPct = crksHuman / 10_000;
  const multiplier = 1 + (bonusPct / 100);

  // Next +1 label (from backend timing)
  const nextLabel = useMemo(() => {
    if (staminaCap === 0 || stamina == null || staminaCap == null) return "Full";
    if (stamina >= staminaCap) return "Full";
    return nextTickMs > 0 ? `Next +1 in ${fmtETA(nextTickMs)}` : "—";
  }, [stamina, staminaCap, nextTickMs]);

  // UI state
  const [infoKey, setInfoKey] = useState(null);
  const [result, setResult] = useState(null);
  const [playingKey, setPlayingKey] = useState(null);

  // Player snapshot for engine
  const player = {
    stamina: Number(stamina ?? 0),
    strength: totalStrength,
    multiplier,
    rankName: currentRank?.name || "Prospect",
  };

  async function onPlay(key) {
    if (playingKey) return;
    setPlayingKey(key);

    try {
      const temp = { ...player };
      const res = runHeist(heistsData, key, temp);

      if (res.type === "blocked") {
        setResult({ blocked: true, message: res.reason });
        return;
      }

      // instant UX: decrement local shadow; backend remains the source of truth
      setStamina((s) => Math.max(0, Number(s || 0) - (res.staminaCost || 0)));

      if (!res.success) {
        recordHeist?.("loss");
        setResult({
          success: false,
          message: res.message,
          points: res.pointsChange,
          staminaCost: res.staminaCost,
        });
        return;
      }

      awardTokens?.(res.rewards, { addFactionPoints: res.pointsChange });

      // Persist rewards server-side
      try {
        await apiFetch("/api/rewardBatch", {
          method: "POST",
          wallet: address,
          body: {
            wallet: address,
            rewards: res.rewards,
            reason: "heist_reward",
            ref: `heist:${key}`,
          },
        });
      } catch (e) {
        console.warn("[backend] rewardBatch failed:", e?.message);
      }

      recordHeist?.("win");
      setResult({
        success: true,
        message: res.message,
        rewards: res.rewards,
        points: res.pointsChange,
        lucky: res.lucky,
        luckyMultiplier: res.luckyMultiplier,
        staminaCost: res.staminaCost,
      });
    } finally {
      // always re-sync with backend at the end
      await refreshStamina();
      setPlayingKey(null);
    }
  }

  // Prepare heists list
  const heistEntries = useMemo(() => {
    const arr = Object.entries(heistsData.heists || {});
    arr.sort((a,b) => (a[1].stamina_cost - b[1].stamina_cost) || a[1].title.localeCompare(b[1].title));
    return arr.slice(0, 10);
  }, []);

  return (
    <div
      className="min-h-screen w-full text-neutral-50 relative"
      style={{
        backgroundImage: "url('/pictures/crooks-empire2-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.55),rgba(0,0,0,0.85))]" />
      <div className="relative max-w-6xl mx-auto p-6">

        <header className={`${GLASS} ${SOFT} p-4 md:p-5 flex items-center justify-between gap-4`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Heists</h1>
            <p className="opacity-80 text-sm md:text-base">Pick a job, spend stamina, and stack tokens & points.</p>
          </div>
          <div className="flex items-center gap-2">
            {!networkOk && (
              <span className="text-xs bg-red-500/20 border border-red-400/40 rounded-xl px-2 py-1">
                Not on Cronos (25)
              </span>
            )}
            <Link to="/empire/profile" className={BTN_GHOST}>Back to Profile</Link>
          </div>
        </header>

        {/* Summary strip */}
        <section className="mt-5 grid grid-cols-1 md:grid-cols-5 gap-3">
          <SummaryTile
            label="Stamina"
            value={
              stamina == null || staminaCap == null
                ? "— / —"
                : `${formatInt(stamina)} / ${formatInt(staminaCap)}`
            }
            // % towards the next +1 (fills over the hour)
            progressPct={
              staminaCap > 0 && stamina != null && stamina < staminaCap
                ? Math.max(0, Math.min(1, 1 - (Number(nextTickMs || 0) / 3_600_000)))
                : 1
            }
            subRight={nextLabel}
          />
          <SummaryTile label="Strength" value={formatInt(totalStrength)} />
          <SummaryTile label="Weapons" value={formatInt(weaponsCount)} />
          <SummaryTile label="Multiplier" value={`${multiplier.toFixed(2)}×`} hint={`+${bonusPct.toFixed(2)}% from CRKS`} />
          <SummaryTile label="Rank" value={`${currentRank.name}`} />
        </section>

        {/* Heist grid */}
        <section className="mt-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {heistEntries.map(([key, h]) => {
              const imgSrc = HEIST_IMG(key);
              const canAfford = (stamina ?? 0) >= h.stamina_cost;
              const okRole = rankAtLeast(currentRank.name, h.min_role);
              const warnStrength = totalStrength < h.recommended_strength;

              return (
                <div key={key} className={`${GLASS} ${SOFT} p-3`}>
                  <div className="relative w-full h-40 rounded-xl overflow-hidden border border-white/10 bg-white/5">
                    <img
                      src={imgSrc}
                      onError={(e) => (e.currentTarget.src = FALLBACK_IMG)}
                      alt={h.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute top-2 left-2 text-xs bg-black/60 rounded-lg px-2 py-1 border border-white/10">
                      {h.difficulty}
                    </div>
                    <div className="absolute top-2 right-2 text-xs bg-black/60 rounded-lg px-2 py-1 border border-white/10">
                      {h.stamina_cost} ⚡
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <div className="text-lg font-semibold">{h.title}</div>
                      <div className="text-xs opacity-70">
                        Min Rank: <b>{h.min_role}</b> • Tokens: {h.token_drops.min === h.token_drops.max ? h.token_drops.min : `${h.token_drops.min}-${h.token_drops.max}`}
                      </div>
                      <div className="text-xs opacity-70">Recommended Strength: {formatInt(h.recommended_strength)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className={BTN_GHOST} onClick={() => setInfoKey(key)}>Info</button>
                      <button
                        className={BTN_PRIMARY}
                        onClick={() => onPlay(key)}
                        disabled={!canAfford || !okRole || playingKey === key}
                        title={
                          !okRole
                            ? `Requires ${h.min_role}+`
                            : !canAfford
                            ? "Not enough stamina"
                            : playingKey === key
                            ? "Playing..."
                            : "Play"
                        }
                      >
                        {playingKey === key ? "Playing..." : "Play"}
                      </button>
                    </div>
                  </div>

                  {warnStrength && (
                    <div className="mt-2 text-xs text-amber-300/90">
                      Your strength is below recommended. Success chance reduced.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Heist Info Modal */}
      {infoKey && (
        <Modal onClose={() => setInfoKey(null)} title={heistsData.heists[infoKey]?.title || "Heist Info"}>
          <HeistInfo k={infoKey} h={heistsData.heists[infoKey]} />
        </Modal>
      )}

      {/* Result Modal */}
      {result && (
        <Modal onClose={() => setResult(null)} title={result.blocked ? "Can't play" : (result.success ? "Heist Success" : "Heist Failed")}>
          {result.blocked ? (
            <div className="text-sm opacity-90">{result.message}</div>
          ) : result.success ? (
            <div className="space-y-2">
              <div className="text-sm">{result.message}</div>
              {result.lucky && (
                <div className="text-xs text-emerald-300">Lucky bonus ×{result.luckyMultiplier.toFixed(2)} applied.</div>
              )}
              <div className="text-sm">
                <b>Rewards:</b>{" "}
                {Object.entries(result.rewards).map(([t,v], i) => (
                  <span key={t}>
                    {i>0 ? ", " : ""}{v} {t}
                  </span>
                ))}
              </div>
              <div className="text-sm"><b>Points:</b> +{formatInt(result.points)}</div>
              {result && result.staminaCost != null && (
                <div className="text-xs opacity-80">Stamina: -{formatInt(result.staminaCost)} ⚡</div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm">{result.message}</div>
              <div className="text-sm"><b>Points:</b> {formatInt(result.points)}</div>
              {result && result.staminaCost != null && (
                <div className="text-xs opacity-80">Stamina: -{formatInt(result.staminaCost)} ⚡</div>
              )}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

/* ---- Subcomponents ---- */

function SummaryTile({ label, value, hint, progressPct, subRight }) {
  const showBar = typeof progressPct === "number";
  const pct = Math.max(0, Math.min(1, progressPct ?? 0));

  return (
    <div className={`${GLASS} ${SOFT} p-4`}>
      <div className="text-xs opacity-70 flex items-center justify-between">
        <span>{label}</span>
        {subRight ? <span className="opacity-80">{subRight}</span> : null}
      </div>

      <div className="text-2xl font-bold mt-1">{value}</div>

      {showBar && (
        <div className="mt-2">
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out bg-gradient-to-r from-emerald-400/70 to-emerald-300/90"
              style={{ width: `${(pct * 100).toFixed(1)}%` }}
            />
          </div>
        </div>
      )}

      {hint ? <div className="text-[11px] opacity-60 mt-2">{hint}</div> : null}
    </div>
  );
}

function HeistInfo({ k, h }) {
  const usd = `${formatInt(h.amount_usd_range[0] * 100)}¢ – ${formatInt(h.amount_usd_range[1] * 100)}¢ (per token drop, pre-multiplier)`;
  return (
    <div className="text-sm space-y-2">
      <div><b>Difficulty:</b> {h.difficulty}</div>
      <div><b>Min Rank:</b> {h.min_role}</div>
      <div><b>Stamina Cost:</b> {h.stamina_cost}</div>
      <div><b>Recommended Strength:</b> {formatInt(h.recommended_strength)}</div>
      <div><b>Token Drops:</b> {h.token_drops.min === h.token_drops.max ? h.token_drops.min : `${h.token_drops.min}-${h.token_drops.max}`} distinct token(s)</div>
      <div><b>USD per Drop:</b> {usd}</div>
      <div><b>Success Points:</b> {h.points_if_success[0]}–{h.points_if_success[1]} • <b>Fail Points:</b> {h.loss_points_if_fail[0]}–{h.loss_points_if_fail[1]}</div>
      <div className="opacity-70 text-xs">Lucky bonus may multiply the USD per drop; your CRKS multiplier applies after that.</div>
      <div className="mt-2">
        <b>Examples:</b>
        <ul className="list-disc ml-5 opacity-80">
          {(h.success_msgs || []).slice(0,2).map((s,i) => <li key={i}>{s.replace("{loot}", "…").replace("{token}", "")}</li>)}
        </ul>
      </div>
    </div>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`${GLASS} ${SOFT} relative w-full max-w-lg p-5`}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button className={BTN_GHOST} onClick={onClose}>Close</button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
