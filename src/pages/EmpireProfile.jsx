// src/pages/EmpireProfile.jsx
import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { useEmpire } from "../context/EmpireContext";
import { Link } from "react-router-dom";

// ---------- Contracts ----------
const CRKL_NFT_ADDRESS = (import.meta.env.VITE_CRKL_NFT_ADDRESS ||
  "0x44102b7ab3e2b8edf77d188cd2b173ecbda60967").trim();

const WEAPON_NFT_ADDRESS = (import.meta.env.VITE_WEAPON_NFT_ADDRESS ||
  "0xB09b903403775Ac0e294B845bF157Bd6A5e8e329").trim();

const CRKS_ADDRESS = (import.meta.env.VITE_CRKS_CA || "").trim();
const API_BASE = import.meta.env.VITE_BACKEND_URL || "https://crooks-backend.steph-danser.workers.dev";

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

// ---------- Rank config ----------
const RANKS = [
  { id: 1, name: "Prospect", min: 0 },
  { id: 2, name: "Member", min: 1 },
  { id: 3, name: "Hustler", min: 2 },
  { id: 4, name: "Street Soldier", min: 3 },
  { id: 5, name: "Enforcer", min: 5 },
  { id: 6, name: "Officer", min: 10 },
  { id: 7, name: "Captain", min: 25 },
  { id: 8, name: "General", min: 50 },
  { id: 9, name: "Gang Leader", min: 75 },
  { id: 10, name: "Boss", min: 100 },
  { id: 11, name: "Kingpin", min: 150 },
  { id: 12, name: "Overlord", min: 200 },
  { id: 13, name: "Icon", min: 300 },
  { id: 14, name: "Legend", min: 400 },
  { id: 15, name: "Immortal", min: 500 },
];

const RANK_IMAGE_MAP = Object.fromEntries(
  RANKS.map((r) => [r.name, `${r.name.replace(" ", "")}.png`])
);
const getRankImgSrc = (name) =>
  RANK_IMAGE_MAP[name]
    ? `/pictures/rank/${RANK_IMAGE_MAP[name]}`
    : "/pictures/satoshi.png";

function computeRank(count) {
  let current = RANKS[0];
  for (const r of RANKS) if (count >= r.min) current = r;
  const next = RANKS.find((r) => r.min > current.min) || null;
  const toNext = next ? Math.max(0, next.min - count) : 0;
  const pct = next
    ? Math.min(100, Math.round(((count - current.min) / (next.min - current.min)) * 100))
    : 100;
  return { current, next, toNext, pct };
}

// ---------- UI helpers ----------
const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const SOFT_SHADOW = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const BTN = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_GHOST = `${BTN} bg-white/8 hover:bg-white/14 border border-white/12`;
const BTN_PRIMARY = `${BTN} bg-emerald-500 text-black hover:bg-emerald-400`;
const BADGE = "inline-flex items-center gap-2 rounded-xl px-2 py-1 bg-white/8 border border-white/10 text-xs";

// ---------- Helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function resolveMediaUrl(u) {
  if (!u) return null;
  if (u.startsWith("ipfs://")) return "https://ipfs.io/ipfs/" + u.slice(7);
  if (u.startsWith("ar://")) return `https://arweave.net/${u.slice(5)}`;
  return u;
}
async function fetchJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}
function parseStrength(meta) {
  const attrs = meta?.attributes || meta?.traits || [];
  const hit = attrs.find((a) =>
    ["strength", "power"].includes(String(a?.trait_type || a?.type || "").toLowerCase())
  );
  const v = Number(String(hit?.value ?? meta?.strength ?? meta?.power ?? 0).replace(/[^\d.]/g, ""));
  return Number.isFinite(v) ? v : 0;
}

export default function EmpireProfile() {
  const { provider, address, networkOk } = useWallet();
  const [backendBalances, setBackendBalances] = useState([]);

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
    initStaminaIfNeeded,
    tickStamina,
  } = useEmpire();

  // -------- Backend sync --------
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

  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/me/balances`, {
          headers: { "X-Wallet-Address": address },
        });
        const j = await res.json();
        if (Array.isArray(j?.balances)) setBackendBalances(j.balances);
      } catch (e) {
        console.warn("[backend] balances fetch failed", e);
      }
    })();
  }, [address]);

  // -------- On-chain state --------
  const [readProvider, setReadProvider] = useState(null);
  const [crklCount, setCrklCount] = useState(0);
  const [crklMeta, setCrklMeta] = useState({ symbol: "CRKL" });
  const [crksHuman, setCrksHuman] = useState(0);
  const [totalStrength, setTotalStrength] = useState(0);

  useEffect(() => {
    if (provider) setReadProvider(provider);
    else setReadProvider(new ethers.JsonRpcProvider("https://evm.cronos.org"));
  }, [provider]);

  const crkl = useMemo(
    () => (readProvider ? new ethers.Contract(CRKL_NFT_ADDRESS, ERC721_ABI, readProvider) : null),
    [readProvider]
  );
  const weapons = useMemo(
    () => (readProvider ? new ethers.Contract(WEAPON_NFT_ADDRESS, ERC721_ABI, readProvider) : null),
    [readProvider]
  );

  // CRKL NFTs
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
      } catch {}
    })();
  }, [crkl, address]);

  // CRKS balance
  useEffect(() => {
    (async () => {
      if (!readProvider || !address || !CRKS_ADDRESS) return;
      try {
        const c = new ethers.Contract(CRKS_ADDRESS, ERC20_ABI, readProvider);
        const [bal, dec] = await Promise.all([
          c.balanceOf(address),
          c.decimals().catch(() => 18),
        ]);
        setCrksHuman(Number(ethers.formatUnits(bal, dec)));
      } catch {}
    })();
  }, [readProvider, address]);

  // Weapons → total Strength
  useEffect(() => {
    (async () => {
      if (!weapons || !address) return;
      try {
        const ENUM_ID = "0x780e9d63";
        const enumerable = await weapons.supportsInterface(ENUM_ID).catch(() => false);
        if (!enumerable) return setTotalStrength(0);

        const bal = await weapons.balanceOf(address);
        const n = Number(bal || 0n);
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const id = await weapons.tokenOfOwnerByIndex(address, i);
          const uri = await weapons.tokenURI(id).catch(() => null);
          const meta = uri ? await fetchJson(resolveMediaUrl(uri)) : null;
          sum += parseStrength(meta || {});
          await sleep(50);
        }
        setTotalStrength(sum);
      } catch {
        setTotalStrength(0);
      }
    })();
  }, [weapons, address]);

  // -------- Rank & stamina --------
  const { current, next, toNext, pct } = computeRank(crklCount);
  useEffect(() => {
    if (!current?.name) return;
    initStaminaIfNeeded(current.name);
    tickStamina(current.name);
    const id = setInterval(() => tickStamina(current.name), 60_000);
    return () => clearInterval(id);
  }, [current?.name]);

  // -------- UI --------
  const faction = empire.faction;
  const stats = empire.heists || { played: 0, wins: 0, losses: 0 };

  const bonusPct = crksHuman / 10_000;
  const bonusFactor = 1 + bonusPct / 100;

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
        <header className={`${GLASS} ${SOFT_SHADOW} p-4 md:p-5 flex items-center justify-between`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Profile</h1>
            <p className="opacity-80 text-sm">Your rank, stats, and backend balances</p>
          </div>
          <div className="flex items-center gap-2">
            {!networkOk && (
              <span className="text-xs bg-red-500/20 border border-red-400/40 rounded-xl px-2 py-1">
                Not on Cronos (25)
              </span>
            )}
            <Link to="/empire/bank" className={BTN_GHOST}>Bank</Link>
            <button className={BTN_GHOST} onClick={() => window.location.reload()}>
              Refresh
            </button>
          </div>
        </header>

        {/* Top summary cards */}
        <section className="mt-5 grid grid-cols-1 lg:grid-cols-4 gap-4">
          <SummaryCard title="Rank" value={current.name} sub={`Rank ${current.id}`} img={getRankImgSrc(current.name)} />
          <SummaryCard title="Strength" value={totalStrength} sub="Weapons total strength" />
          <SummaryCard title="Multiplier" value={`${bonusFactor.toFixed(2)}×`} sub={`+${bonusPct.toFixed(2)}%`} />
          <SummaryCard title="Faction" value={faction?.name || "None"} sub={faction?.token || ""} />
        </section>

        {/* Backend balances */}
        <section className="mt-5">
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <h3 className="font-semibold text-lg">Balances (Backend)</h3>
            {backendBalances.length === 0 ? (
              <div className="mt-3 text-sm opacity-70">No balances yet.</div>
            ) : (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {backendBalances.map((b) => (
                  <StatTile key={b.token_symbol} label={b.token_symbol} value={Number(b.balance).toLocaleString()} />
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Heists */}
        <section className="mt-5">
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <h3 className="font-semibold text-lg">Heists</h3>
            <div className="mt-3 grid grid-cols-3 gap-3">
              <StatTile label="Played" value={formatInt(stats.played)} />
              <StatTile label="Wins" value={formatInt(stats.wins)} />
              <StatTile label="Losses" value={formatInt(stats.losses)} />
            </div>
          </div>
        </section>

        <footer className="mt-8 text-center text-xs opacity-60">
          CRKL: <code>{CRKL_NFT_ADDRESS}</code> • Weapons: <code>{WEAPON_NFT_ADDRESS}</code> {CRKS_ADDRESS && <>• CRKS: <code>{CRKS_ADDRESS}</code></>}
        </footer>
      </div>
    </div>
  );
}

// ---------- Small components ----------
function SummaryCard({ title, value, sub, img }) {
  return (
    <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
      <div className="text-sm opacity-70">{title}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
      {sub && <div className="text-xs opacity-70">{sub}</div>}
      {img && (
        <div className="mt-2 w-10 h-10">
          <img src={img} alt={title} className="w-full h-full rounded-lg object-cover" />
        </div>
      )}
    </div>
  );
}
function StatTile({ label, value }) {
  return (
    <div className="bg-white/5 rounded-xl p-3 border border-white/10">
      <div className="text-xs opacity-70">{label}</div>
      <div className="text-xl font-bold mt-1">{value}</div>
    </div>
  );
}
function formatInt(n) {
  const x = Number(n || 0);
  return Number.isFinite(x) ? x.toLocaleString() : "0";
}
