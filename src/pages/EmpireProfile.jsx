// src/pages/EmpireProfile.jsx
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { useEmpire } from "../context/EmpireContext";
import { Link } from "react-router-dom";

/**
 * Crooks Empire — Profile
 * - Rank from CRKL NFT holdings
 * - Strength from Weapons NFT metadata (sum of Strength/Power)
 * - Earn Multiplier from CRKS ERC-20 balance
 * - Faction selection & weekly leaderboard (via EmpireContext; persists in localStorage)
 * - Balances from backend with local fallback (same behavior as Bank)
 */

// ===== Contracts (Cronos) =====
const CRKL_NFT_ADDRESS = (import.meta.env.VITE_CRKL_NFT_ADDRESS ||
  "0x44102b7ab3e2b8edf77d188cd2b173ecbda60967").trim();

const WEAPON_NFT_ADDRESS = (import.meta.env.VITE_WEAPON_NFT_ADDRESS ||
  "0xB09b903403775Ac0e294B845bF157Bd6A5e8e329").trim();

// Always show these tokens (even if balance = 0)
const ALL_TOKENS = [
  "CRKS", "CRO", "CROCARD", "MOON", "BOBZ", "BONE", "CRY", "KRIS",
];

const CRKS_ADDRESS = (import.meta.env.VITE_CRKS_CA || "").trim(); // set in .env to enable multiplier

// 🔁 Use the same API base as Bank
const API_BASE =
  import.meta.env.VITE_BACKEND_URL ||
  "https://crooks-backend.steph-danser.workers.dev";

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
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

// ===== Rank thresholds (no emojis/earns text) =====
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

// Emojis for each rank (used in UI)
const RANK_EMOJI = {
  "Prospect": "",
  "Member": "",
  "Hustler": "",
  "Street Soldier": "",
  "Enforcer": "",
  "Officer": "",
  "Captain": "",
  "General": "",
  "Gang Leader": "",
  "Boss": "",
  "Kingpin": "",
  "Overlord": "",
  "Icon": "",
  "Legend": "",
  "Immortal": "",
};
const rankEmoji = (name) => (RANK_EMOJI[name] ? `${RANK_EMOJI[name]} ` : "");

// Map rank name -> filename in /pictures/rank
const RANK_IMAGE_MAP = {
  "Prospect": "Prospect.png",
  "Member": "Member.png",
  "Hustler": "Hustler.png",
  "Street Soldier": "Streetsoldier.png",
  "Enforcer": "Enforcer.png",
  "Officer": "Officer.png",
  "Captain": "Captain.png",
  "General": "General.png",
  "Gang Leader": "Gangleader.png",
  "Boss": "Boss.png",
  "Kingpin": "Kingpin.png",
  "Overlord": "Overlord.png",
  "Icon": "Icon.png",
  "Legend": "Legend.png",
  "Immortal": "Immortal.png",
};

function getRankImgSrc(rankName) {
  const fn = RANK_IMAGE_MAP[rankName] || "";
  return fn ? `/pictures/rank/${fn}` : "/pictures/satoshi.png";
}

function computeRank(count) {
  let current = RANKS[0];
  for (const r of RANKS) if (count >= r.min) current = r;
  const next = RANKS.find(r => r.min > current.min) || null;
  const toNext = next ? Math.max(0, next.min - count) : 0;
  const pct = next
    ? Math.max(0, Math.min(100, Math.round(((count - current.min) / (next.min - current.min)) * 100)))
    : 100;
  return { current, next, toNext, pct };
}

// ===== Factions (display metadata only) =====
const FACTIONS = [
  { id: "crohounds",       name: "CROHOUNDS",        token: "BONE",    color: "from-emerald-300/60 to-emerald-500/30",  logo: "/pictures/factions/crohounds.png",       initials: "CH" },
  { id: "wolfswap",        name: "Wolfswap",         token: "MOON",    color: "from-sky-300/60 to-sky-500/30",          logo: "/pictures/factions/wolfswap.png",        initials: "WS" },
  { id: "crooks",          name: "Crooks",           token: "CRKS",    color: "from-emerald-400/60 to-emerald-600/30",  logo: "/pictures/factions/crooks.png",          initials: "CK" },
  { id: "crazzzymonsters", name: "Crazzzy Monsters", token: "CRY",     color: "from-fuchsia-300/60 to-fuchsia-500/30",  logo: "/pictures/factions/crazzzymonsters.png", initials: "CM" },
  { id: "cardsofcronos",   name: "Cards of Cronos",  token: "CROCARD", color: "from-amber-300/60 to-amber-500/30",      logo: "/pictures/factions/cardsofcronos.png",   initials: "COC" },
  { id: "bobsadventures",  name: "BobsAdventures",   token: "BOBZ",    color: "from-purple-300/60 to-purple-500/30",    logo: "/pictures/factions/bobsadventures.png",  initials: "BA" },
  { id: "kristoken",       name: "Kris Token",       token: "KRIS",    color: "from-rose-300/60 to-rose-500/30",        logo: "/pictures/factions/kristoken.png",       initials: "KR" },
];

// ===== Small helpers reused from Armory =====
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
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
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

// ===== UI helpers =====
const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const SOFT_SHADOW = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const BTN = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_GHOST = `${BTN} bg-white/8 hover:bg-white/14 border border-white/12`;
const BTN_PRIMARY = `${BTN} bg-emerald-500 text-black hover:bg-emerald-400`;
const BADGE = "inline-flex items-center gap-2 rounded-xl px-2 py-1 bg-white/8 border border-white/10 text-xs";

export default function EmpireProfile() {
  const { provider, address, networkOk } = useWallet();

  // Balances from backend (raw rows)
  const [backendBalances, setBackendBalances] = useState([]);

  // Empire store (local game state; persisted via localStorage)
  const {
    state: empire,
    setFaction,
    clearFaction,
    awardTokens,
    recordHeist,
    setStamina,
    hydrateFromWallet,
    resetWeek,
    resetMonth,
    stamina,
    staminaCap,
    nextTickMs,
    refreshStamina,
  } = useEmpire();

  // Hydrate store with connected wallet + ensure backend user exists
  useEffect(() => {
    if (!address) return;

    hydrateFromWallet(address);

    (async () => {
      try {
        await fetch(`${API_BASE}/api/me`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wallet: address }),
        });
      } catch (e) {
        console.warn("[backend] user sync failed:", e);
      }
    })();
  }, [address, hydrateFromWallet]);

  // Fetch balances from backend
  useEffect(() => {
    if (!address) {
      setBackendBalances(ALL_TOKENS.map(sym => ({ token_symbol: sym, balance: 0 })));
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/me/balances`, {
          headers: { "X-Wallet-Address": address },
          cache: "no-store",
        });
        const j = await res.json().catch(() => null);

        const incoming = Array.isArray(j?.balances) ? j.balances
                        : Array.isArray(j) ? j
                        : [];

        const normalized = incoming.map((row) => {
          const sym = String(row?.token_symbol || row?.symbol || row?.token || "").toUpperCase();
          const bal = Number(row?.balance ?? row?.amount ?? 0);
          return sym ? { token_symbol: sym, balance: Number.isFinite(bal) ? bal : 0 } : null;
        }).filter(Boolean);

        // Merge with canonical list → always show all tokens
        const map = new Map(normalized.map(r => [r.token_symbol.toUpperCase(), r.balance]));
        const complete = ALL_TOKENS.map(sym => ({
          token_symbol: sym,
          balance: Number(map.get(sym) ?? 0),
        }));

        setBackendBalances(complete);
      } catch (e) {
        console.warn("Failed to load backend balances:", e);
        setBackendBalances(ALL_TOKENS.map(sym => ({ token_symbol: sym, balance: 0 })));
      }
    })();
  }, [address]);

  // 🔁 Make Profile behave like Bank: prefer backend, fallback to local store
  const backendMap = useMemo(() => {
    const m = {};
    for (const r of backendBalances || []) {
      const sym = String(r?.token_symbol || r?.symbol || r?.token || "").toUpperCase();
      const num = Number(r?.balance ?? r?.amount ?? 0);
      if (sym) m[sym] = Number.isFinite(num) ? num : 0;
    }
    return m;
  }, [backendBalances]);

  const localMap = useMemo(() => {
    const src = empire?.tokensEarned || {};
    const m = {};
    ALL_TOKENS.forEach(sym => { m[sym] = Number(src[sym] ?? 0); });
    return m;
  }, [empire]);

  const displayBalances = useMemo(() => {
    return ALL_TOKENS.map(sym => ({
      token_symbol: sym,
      balance: Number(backendMap[sym] ?? localMap[sym] ?? 0),
      source: backendMap[sym] !== undefined ? "backend" : "local",
    }));
  }, [backendMap, localMap]);

  const [readProvider, setReadProvider] = useState(null);

  // On-chain state
  const [crklCount, setCrklCount] = useState(0);
  const [crklMeta, setCrklMeta] = useState({ name: "CRKL", symbol: "CRKL" });
  const [crksHuman, setCrksHuman] = useState(0);
  const [totalStrength, setTotalStrength] = useState(0);

  // Provider: prefer connected wallet; else public Cronos
  useEffect(() => {
    if (provider) setReadProvider(provider);
    else setReadProvider(new ethers.JsonRpcProvider("https://evm.cronos.org"));
  }, [provider]);

  // Contracts
  const crkl = useMemo(() => {
    if (!readProvider || !CRKL_NFT_ADDRESS) return null;
    return new ethers.Contract(CRKL_NFT_ADDRESS, ERC721_ABI, readProvider);
  }, [readProvider]);

  const weapons = useMemo(() => {
    if (!readProvider || !WEAPON_NFT_ADDRESS) return null;
    return new ethers.Contract(WEAPON_NFT_ADDRESS, ERC721_ABI, readProvider);
  }, [readProvider]);

  // Load CRKL balance + meta
  useEffect(() => {
    (async () => {
      if (!crkl || !address) return;
      try {
        const [bal, name, symbol] = await Promise.all([
          crkl.balanceOf(address).catch(() => 0n),
          crkl.name().catch(() => "CRKL"),
          crkl.symbol().catch(() => "CRKL"),
        ]);
        setCrklCount(Number(bal || 0n));
        setCrklMeta({ name, symbol });
      } catch (e) {
        console.warn("[profile] CRKL read failed", e);
      }
    })();
  }, [crkl, address]);

  // Load CRKS balance (for multiplier)
  useEffect(() => {
    (async () => {
      if (!readProvider || !address || !CRKS_ADDRESS) return;
      try {
        const c = new ethers.Contract(CRKS_ADDRESS, ERC20_ABI, readProvider);
        const [bal, dec] = await Promise.all([
          c.balanceOf(address).catch(() => 0n),
          c.decimals().catch(() => 18),
        ]);
        const human = Number(ethers.formatUnits(bal, Number(dec || 18)));
        setCrksHuman(Number.isFinite(human) ? human : 0);
      } catch (e) {
        console.debug("[profile] CRKS read skipped", e);
      }
    })();
  }, [readProvider, address]);

  // Load Weapons → sum Strength (same as Armory)
  useEffect(() => {
    (async () => {
      if (!weapons || !address) return;

      try {
        const ENUM_ID = "0x780e9d63";
        const enumerable = await weapons.supportsInterface(ENUM_ID).catch(() => false);
        if (!enumerable) {
          setTotalStrength(0);
          return;
        }

        const bal = await weapons.balanceOf(address);
        const n = Number(bal || 0n);
        const ids = [];
        for (let i = 0; i < n; i++) {
          const id = await weapons.tokenOfOwnerByIndex(address, i);
          ids.push(Number(id));
        }
        ids.sort((a, b) => a - b);

        let sum = 0;
        for (const id of ids) {
          let meta = null;
          try {
            const uri = await weapons.tokenURI(id);
            const url = resolveMediaUrl(uri);
            if (url) meta = await fetchJson(url);
          } catch {}
          if (!meta) meta = await fetchJson(`/metadata_weapons/${id}.json`);
          sum += parseStrength(meta);
          await sleep(50);
        }
        setTotalStrength(sum);
      } catch (e) {
        console.warn("[profile] weapons/strength read failed", e);
        setTotalStrength(0);
      }
    })();
  }, [weapons, address]);

  // Multiplier rule:
  // 1,000,000 CRKS => +100% ; 5,000,000 => +500%
  // => bonusPct = CRKS / 10,000 ; factor = 1 + bonusPct/100
  const bonusPct = crksHuman / 10_000;
  const bonusFactor = 1 + (bonusPct / 100);

  const { current, next, toNext, pct } = computeRank(crklCount);

  useEffect(() => {
    if (!current?.name) return;
    refreshStamina().catch(() => {});
    const id = setInterval(() => refreshStamina().catch(() => {}), 60_000);
    return () => clearInterval(id);
  }, [current?.name, refreshStamina]);

  // Faction & Stats from store
  const faction = empire.faction;
  const stats = {
    tokensEarned: empire.tokensEarned,
    heists: empire.heists,
    stamina: empire.stamina,
  };

  function chooseFaction(f) {
    setFaction(f);
    // Later: also POST to backend
  }

  // Weekly leaderboard (simple derived data; later replace with backend data)
  const weeklyFactionStats = (() => {
    const base = FACTIONS.map(f => ({
      id: f.id,
      name: f.name,
      points: 0,
    }));
    if (faction) {
      const ix = base.findIndex(x => x.id === faction.id);
      if (ix >= 0) base[ix].points = empire.factionPointsWeek || 0;
    }
    return base;
  })();

  return (
    <div
      className="min-h-screen w-full text-neutral-50 relative bg-animated"
      style={{
        backgroundImage: "url('/pictures/crooks-empire2-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.55),rgba(0,0,0,0.85))]" />
      <div className="relative max-w-6xl mx-auto p-6">
        <header className={`${GLASS} ${SOFT_SHADOW} p-4 md:p-5 flex items-center justify-between gap-4`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Profile</h1>
            <p className="opacity-80 text-sm md:text-base">Your rank, faction & stats in Crooks Empire</p>
          </div>
          <div className="flex items-center gap-2">
            {!networkOk && (
              <span className="text-xs bg-red-500/20 border border-red-400/40 rounded-xl px-2 py-1">
                Not on Cronos (25)
              </span>
            )}

            {/* Quick nav */}
            <Link to="/empire/bank" className={`${BTN} bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl`}>Bank</Link>
            <Link to="/empire/heists" className={`${BTN} bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl`}>Heists</Link>
            <Link to="/empire/armory" className={`${BTN} bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl`}>Armory</Link>
            <Link to="/empire/casino" className={`${BTN} bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl`}>Casino</Link>

            {/* Manual refresh */}
            <button className={BTN_GHOST} onClick={() => { refreshStamina().catch(() => {}); }}>
              Refresh
            </button>
          </div>
        </header>

        {/* Top cards */}
        <section className="mt-5 grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Rank */}
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <div className="text-sm opacity-70">Rank</div>
            <div className="mt-1 text-2xl md:text-3xl font-semibold">
              {rankEmoji(current.name)}{current.name} <span className="text-base opacity-70">• Rank {current.id}</span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-white/10 border border-white/10 shrink-0">
                <img src={getRankImgSrc(current.name)} alt={`${current.name} badge`} className="w-full h-full object-cover" loading="lazy" />
              </div>
              <div className="text-sm opacity-80">
                Holdings: <b>{crklCount} {crklMeta.symbol}</b>
              </div>
            </div>
            <div className="mt-4">
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-xs opacity-70">
                {next ? <>Progress to <b>{next.name}</b>: {pct}% • Need <b>{toNext}</b> more CRKL</> : "Max rank reached"}
              </div>
            </div>
          </div>

          {/* Strength */}
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <div className="text-sm opacity-70">Strength</div>
            <div className="mt-1 text-3xl font-bold">{totalStrength}</div>
            <div className="mt-2 text-xs opacity-70">Computed from your Weapons’ Strength/Power attributes.</div>
          </div>

          {/* Earn Multiplier */}
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <div className="text-sm opacity-70">Earn Multiplier</div>
            <div className="mt-1 text-3xl font-bold">{bonusFactor.toFixed(2)}×</div>
            <div className="mt-1 text-xs opacity-70">Bonus: +{bonusPct.toFixed(2)}% from {fmt(crksHuman)} CRKS</div>
            {!CRKS_ADDRESS && <div className="mt-2 text-xs opacity-60">Set <code>VITE_CRKS_CA</code> to auto-detect CRKS balance.</div>}
          </div>

          {/* Faction snapshot */}
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <div className="text-sm opacity-70">Faction</div>
            <div className="mt-1 text-xl font-semibold">{faction ? faction.name : "None selected"}</div>
            {faction && (
              <div className="mt-2 inline-flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg overflow-hidden bg-white/10 border border-white/10">
                  {faction.logo ? <img src={faction.logo} alt={faction.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs">{faction.initials}</div>}
                </div>
                <span className={BADGE}>Token: {faction.token}</span>
              </div>
            )}
          </div>
        </section>

        {/* Wallet snapshot + Rank ladder */}
        <section className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <h3 className="font-semibold text-lg">Wallet Snapshot</h3>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatTile label="CRKL Held" value={crklCount} />
              <StatTile label="CRKS (multiplier)" value={fmt(crksHuman)} />
              <StatTile label="Rank" value={current.id} />
              <StatTile label="Total Strength" value={totalStrength} />
            </div>
          </div>

          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <h3 className="font-semibold text-lg">Rank Ladder</h3>
            <div className="mt-3 space-y-2">
              {RANKS.map(r => (
                <div
                  key={r.id}
                  className={`flex items-center justify-between rounded-xl px-3 py-2 border ${
                    crklCount >= r.min ? "border-emerald-400/40 bg-emerald-400/10" : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg overflow-hidden bg-white/10 border border-white/10 shrink-0">
                      <img src={getRankImgSrc(r.name)} alt={`${r.name} badge`} className="w-full h-full object-cover" loading="lazy" />
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">{rankEmoji(r.name)}{r.name}</span>{" "}
                      <span className="opacity-60">• Rank {r.id}</span>
                    </div>
                  </div>
                  <div className="text-xs opacity-80">Holding: <b>{r.min}</b> CRKL</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Faction Picker */}
        <section className={`${GLASS} ${SOFT_SHADOW} p-5 mt-5`}>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Choose your Faction</h2>
            {faction && <button className={BTN_GHOST} onClick={clearFaction}>Clear choice</button>}
          </div>
          <p className="mt-1 text-sm opacity-80">
            The points you earn in Crooks Empire will be linked to your chosen faction. Weekly/monthly winners will get rewards (TBD).
          </p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FACTIONS.map(f => {
              const active = faction?.id === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => chooseFaction(f)}
                  className={`relative text-left p-4 rounded-2xl border ${active ? "border-emerald-400/60" : "border-white/10"} bg-gradient-to-br ${f.color} hover:bg-white/10 transition`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/10 border border-white/10 shrink-0">
                      {f.logo ? <img src={f.logo} alt={f.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center font-semibold">{f.initials}</div>}
                    </div>
                    <div>
                      <div className="font-semibold">{f.name}</div>
                      <div className="text-xs opacity-80">Token: {f.token}</div>
                    </div>
                    <div className="ml-auto">
                      <span className={BADGE}>{active ? "Selected" : "Select"}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* Empire stats (backend balances merged with local fallback) */}
        <section className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`${GLASS} ${SOFT_SHADOW} p-5 lg:col-span-2`}>
            <h3 className="font-semibold text-lg">Balances</h3>
            <p className="text-xs opacity-70 mt-1">
              Backend is authoritative when available. Local values are shown only if the backend has no entry yet.
            </p>

            {displayBalances.length === 0 ? (
              <div className="mt-3 text-sm opacity-70">No balances yet.</div>
            ) : (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {displayBalances.map(r => (
                  <StatTile key={r.token_symbol} label={r.token_symbol} value={fmt(r.balance)} />
                ))}
              </div>
            )}
          </div>

          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <h3 className="font-semibold text-lg">Heists</h3>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <StatTile label="Played" value={formatInt(stats.heists.played)} />
              <StatTile label="Wins" value={formatInt(stats.heists.wins)} />
              <StatTile label="Losses" value={formatInt(stats.heists.losses)} />
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-sm opacity-70 mb-1">
                <span>Current Stamina</span>
                <span>
                  {(Number(staminaCap) === 0 || Number(stamina) >= Number(staminaCap))
                    ? "Full"
                    : `Next +1 in ${fmtETA(nextTickMs || 0)}`}
                </span>
              </div>
              {(() => {
                const cap = Number(staminaCap ?? 0);
                const cur = Number(stamina ?? 0);
                const pct = cap > 0 ? Math.min(100, Math.round((cur / cap) * 100)) : 0;
                return (
                  <>
                    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-xs opacity-70">
                      {cur} / {cap} ({pct}%)
                    </div>
                  </>
                );
              })()}
            </div>

            {new URLSearchParams(location.search).get("dev") === "1" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button className={BTN_GHOST} onClick={() => awardTokens({ CRKS: 50, MOON: 10 }, { addFactionPoints: 50 })}>
                  +50 faction pts (& +50 CRKS, +10 MOON)
                </button>
                <button className={BTN_GHOST} onClick={() => recordHeist("win")}>Heist Win</button>
                <button className={BTN_GHOST} onClick={() => recordHeist("loss")}>Heist Loss</button>
                <button className={BTN_GHOST} onClick={() => setStamina((s) => Math.max(0, s - 15))}>-15 Stamina</button>
                <button className={BTN_GHOST} onClick={resetWeek}>Reset Week</button>
                <button className={BTN_GHOST} onClick={resetMonth}>Reset Month</button>
              </div>
            )}
          </div>
        </section>

        {/* Weekly Faction Leaderboard */}
        <section className="mt-5">
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Faction Leaderboard (This week)</h3>
              <button className={BTN_PRIMARY} onClick={() => { /* later: backend fetch */ }}>
                Refresh
              </button>
            </div>
            <div className="mt-3 max-h-72 overflow-auto pr-1">
              {weeklyFactionStats
                .slice()
                .sort((a, b) => b.points - a.points)
                .map((row, i) => {
                  const f = FACTIONS.find(x => x.id === row.id);
                  return (
                    <div key={row.id} className="flex items-center gap-3 py-2 border-b border-white/10 last:border-b-0">
                      <div className="w-8 text-center opacity-70">{i + 1}</div>
                      <div className="w-8 h-8 rounded-lg overflow-hidden bg-white/10 border border-white/10 shrink-0">
                        {f?.logo ? <img src={f.logo} alt={f?.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs">{f?.initials}</div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{f?.name || row.id}</div>
                        <div className="text-xs opacity-70">Token: {f?.token}</div>
                      </div>
                      <div className="font-mono">{fmt(row.points)}</div>
                    </div>
                  );
                })}
            </div>
            <div className="mt-3 text-xs opacity-70">
              Your earned points will be credited to your selected faction automatically (once backend is connected).
            </div>
          </div>
        </section>

        <footer className="mt-8 text-center text-xs opacity-60">
          CRKL: <code>{CRKL_NFT_ADDRESS}</code> • Weapons: <code>{WEAPON_NFT_ADDRESS}</code> {CRKS_ADDRESS ? <>• CRKS: <code>{CRKS_ADDRESS}</code></> : null}
        </footer>
      </div>
    </div>
  );
}

function StatTile({ label, value }) {
  return (
    <div className="bg-white/5 rounded-xl p-3 border border-white/10">
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-xl font-bold mt-1 break-words">{value}</div>
    </div>
  );
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, Number(n || 0))); }
function formatInt(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString();
}
function fmt(n, maxFrac = 0) {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFrac,
    useGrouping: true,
  });
}
