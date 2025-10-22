// src/pages/CrooksFinance.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";

/* =================== CONFIG =================== */

console.debug("ENV check MOON =", import.meta.env.VITE_STAKE_MOON);

// Your token (temporary)
const TOKEN_ADDRESS = "0xe07375D293D7b8d3758B74FD6a71800A946B3b07";

// Wallets to sum (treasury)
const WALLETS_TO_SUM = [
  "0x1B95F8F67639BBc3153e6D277070518ff122c421",
  "0xb08EC065E3E64F38EC826F6A019C83b457554E1B",
];

// Track treasury tokens (wallet-held).
// ✅ MOON is correct. ⚠️ Fill LION, FUL, CORGIAI, PPFT, VNO, and KACHING with actual token contracts your wallets hold.
const TRACKED_TOKENS = {
  MOON:    "0x46E2B5423F6ff46A8A35861EC9DAfF26af77AB9A",
  LION:    "0x9D8c68F185A04314DDC8B8216732455e8dbb7E45",
  FUL:     "0x83aFB1C32E5637ACd0a452D87c3249f4a9F0013A",
  CORGIAI: "0x6b431B8a964BFcf28191b07c91189fF4403957D0",
  PPFT:    "0x59BAfb7168972EcCA5e395F7dA88e71eCe47a260",
  VNO:     "0xdb7d0A1eC37dE1dE924F8e8adac6Ed338D4404E9",  
  KACHING: "0x4ddA1Bb6E378dCEf97bfF1057b6452615E86373c",  
};


// ---- STAKING: read addresses from .env so you don't edit code again ----
const STAKE = {
  MOON: (import.meta.env.VITE_STAKE_MOON || "").trim(),

  LION_VAULT: (import.meta.env.VITE_STAKE_LION_VAULT || "").trim(),
  LION_CHEF:  (import.meta.env.VITE_STAKE_LION_CHEF  || "").trim(),
  LION_POOLID: Number(import.meta.env.VITE_STAKE_LION_POOLID ?? 0),

  FUL_LOCKER: (import.meta.env.VITE_STAKE_FUL_LOCKER || "").trim(),

  // NEW (simple balanceOf-style staking contracts)
  CORGIAI_STAKE: (import.meta.env.VITE_STAKE_CORGIAI || "").trim(),
  PPFT_STAKE:    (import.meta.env.VITE_STAKE_PPFT    || "").trim(),
  VNO_STAKE:     (import.meta.env.VITE_STAKE_VNO     || "").trim(),
  KACHING_VAULT: (import.meta.env.VITE_STAKE_KACHING_VAULT || "").trim(),
  KACHING_CHEF:  (import.meta.env.VITE_STAKE_KACHING_CHEF  || "").trim(),
};

// helper: only add adapter if we have both a staking contract AND a token address in TRACKED_TOKENS
function maybeStakeAdapter(symbol, pretty, stakeAddr, decimals = 18) {
  if (!stakeAddr) return [];
  const tokenAddr = (TRACKED_TOKENS?.[symbol] || "").toLowerCase();
  if (!tokenAddr || tokenAddr === "0x0000000000000000000000000000000000000000") {
    if (import.meta.env.DEV) {
      console.warn(`[CrooksFinance] Skipping ${symbol} staking: TRACKED_TOKENS.${symbol} not set`);
    }
    return [];
  }
  return [{
    label: `${pretty} Staking`,
    type: "balanceOf",
    contract: stakeAddr,
    asset: { symbol, address: tokenAddr, decimals },
  }];
}

// type options: "balanceOf" | "chef" | "locked" | "vault4626"
const STAKING_ADAPTERS = [
// MOON — single-pool MasterChef-style (no pid): userInfo(address)
...(STAKE.MOON ? [{
  label: "MOON Staking",
  type: "chef",                 // 👈 important change
  contract: STAKE.MOON,         // 0x08A58e…f2F1b from your env
  // no poolId on purpose → code will call userInfo(address)
  asset: { symbol: "MOON", address: TRACKED_TOKENS.MOON, decimals: 18 },
}] : []),

  // LION — either a 4626 vault or a MasterChef
  ...(STAKE.LION_VAULT ? [{
    label: "LION Vault",
    type: "vault4626",
    contract: STAKE.LION_VAULT,
    asset: { symbol: "LION", address: TRACKED_TOKENS.LION, decimals: 18 },
  }] : []),

  ...(STAKE.LION_CHEF ? [{
    label: "LION Farm",
    type: "chef",
    contract: STAKE.LION_CHEF,
    poolId: STAKE.LION_POOLID || 0,
    asset: { symbol: "LION", address: TRACKED_TOKENS.LION, decimals: 18 },
  }] : []),

  // FUL — locker (locked/lockedBalances)
  ...(STAKE.FUL_LOCKER ? [{
    label: "FUL Locker",
    type: "locked",
    contract: STAKE.FUL_LOCKER,
    asset: { symbol: "FUL", address: TRACKED_TOKENS.FUL, decimals: 18 },
  }] : []),

  // NEW — simple “balanceOf” staking pools for the extra tokens
  ...maybeStakeAdapter("CORGIAI", "CORGIAI", STAKE.CORGIAI_STAKE),
  ...maybeStakeAdapter("PPFT",    "PPFT",    STAKE.PPFT_STAKE),
  ...maybeStakeAdapter("VNO",     "VNO",     STAKE.VNO_STAKE),

...(STAKE.KACHING_CHEF ? [{
  label: "KACHING Farm",
  type: "chef",                  // our code handles userInfo(address) and pid fallback
  contract: STAKE.KACHING_CHEF,
  asset: { symbol: "KACHING", address: TRACKED_TOKENS.KACHING, decimals: 18 },
}] : []),

...(STAKE.KACHING_VAULT ? [{
  label: "KACHING Vault",
  type: "vault4626",
  contract: STAKE.KACHING_VAULT,
  asset: { symbol: "KACHING", address: TRACKED_TOKENS.KACHING, decimals: 18 },
}] : []),

];

// DEV: log what Vite sees (only in dev)
if (import.meta.env.DEV) {
  console.debug("[CrooksFinance] STAKE env:", {
    VITE_STAKE_MOON:            import.meta.env.VITE_STAKE_MOON,
    VITE_STAKE_LION_VAULT:      import.meta.env.VITE_STAKE_LION_VAULT,
    VITE_STAKE_LION_CHEF:       import.meta.env.VITE_STAKE_LION_CHEF,
    VITE_STAKE_LION_POOLID:     import.meta.env.VITE_STAKE_LION_POOLID,
    VITE_STAKE_FUL_LOCKER:      import.meta.env.VITE_STAKE_FUL_LOCKER,
    VITE_STAKE_CORGIAI:         import.meta.env.VITE_STAKE_CORGIAI,
    VITE_STAKE_PPFT:            import.meta.env.VITE_STAKE_PPFT,
    VITE_STAKE_VNO:             import.meta.env.VITE_STAKE_VNO,
    VITE_STAKE_KACHING_VAULT: import.meta.env.VITE_STAKE_KACHING_VAULT,
    VITE_STAKE_KACHING_CHEF:  import.meta.env.VITE_STAKE_KACHING_CHEF,
  });
  console.debug("[CrooksFinance] STAKING_ADAPTERS:", STAKING_ADAPTERS);
}



// Endpoints
const DEXSCREENER_TOKEN_URL = (addr) =>
  `https://api.dexscreener.com/latest/dex/tokens/${addr}`;
// Cronos Explorer endpoints vary by deployment. We'll try a few.
const CRONOS_EXPLORER_PATHS = (addr) => [
  `/cronosapi/api/v1/tokens/${addr}`,
  `/cronosapi/api/v1/token/${addr}`,
  `/cronosapi/v1/tokens/${addr}`,
  `/cronosapi/v2/tokens/${addr}`,
];

async function fetchMoralisTokenData(addr) {
  const key = import.meta.env.VITE_MORALIS_KEY;
  if (!key) return null;

  // 1) Metadata (name/symbol/decimals)
  const metaUrl = `https://deep-index.moralis.io/api/v2.2/erc20/metadata?chain=cronos&addresses[]=${addr}`;
  const metaRes = await fetch(metaUrl, { headers: { "X-API-Key": key } });
  if (!metaRes.ok) {
    if (metaRes.status !== 404) console.warn("[Moralis] metadata failed", metaRes.status);
  }
  const meta = metaRes.ok ? await metaRes.json() : null;
  const m = Array.isArray(meta) ? meta[0] : null;

  // 2) Price (USD)
  const priceUrl = `https://deep-index.moralis.io/api/v2.2/erc20/${addr}/price?chain=cronos`;
  const priceRes = await fetch(priceUrl, { headers: { "X-API-Key": key } });
  if (!priceRes.ok) {
    if (priceRes.status !== 404) console.warn("[Moralis] price failed", priceRes.status);
  }
  const priceJson = priceRes.ok ? await priceRes.json() : null;

  return {
    name: m?.name ?? null,
    symbol: m?.symbol ?? null,
    decimals: m?.decimals ?? 18,
    holders: null,              // Moralis v2.2 doesn’t give holders here
    price: priceJson?.usdPrice ?? null,
    marketCap: priceJson?.marketCap ?? null, // may be null if Moralis can’t compute
  };
}

const MORALIS_BASE = "https://deep-index.moralis.io/api/v2.2";

/* =================== STYLES =================== */

const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const GLASS_HOVER = "hover:bg-white/10 hover:border-white/20 transition";
const SOFT_SHADOW = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const BTN = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY = `${BTN} bg-emerald-500 text-black hover:bg-emerald-400`;
const BTN_GHOST = `${BTN} bg-white/8 hover:bg-white/14 border border-white/12`;
const BADGE = "inline-flex items-center gap-2 rounded-xl px-2 py-1 bg-white/8 border border-white/10 text-xs";
const SUB = "text-sm md:text-base opacity-80";

/* =================== HELPERS =================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n, d = 2) => {
  const x = Number(n);
  if (!isFinite(x)) return "—";
  if (Math.abs(x) >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: d });
  return x.toFixed(d);
};
async function fetchJson(url, opts, timeoutMs = 12_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, ...(opts || {}) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// --- CRO price (via CoinGecko) ---
async function fetchCroUsdPrice() {
  try {
    const j = await fetchJson(
      "https://api.coingecko.com/api/v3/simple/price?ids=crypto-com-chain&vs_currencies=usd"
    );
    const p = Number(j?.["crypto-com-chain"]?.usd);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}


/* ============ Sparkline (pure SVG) ============ */

function Sparkline({ data, height = 120, strokeWidth = 2 }) {
  if (!data?.length) {
    return (
      <div className="h-[120px] flex items-center justify-center text-xs opacity-60">
        Loading price…
      </div>
    );
  }
  const padding = 8;
  const w = 600;
  const h = Math.max(60, height);
  const xs = data.map((_, i) => i);
  const ys = data.map((d) => d.p);
  const minX = 0, maxX = xs.length - 1 || 1;
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1e-9, maxY - minY);
  const px = (x) => padding + ((x - minX) / spanX) * (w - padding * 2);
  const py = (y) => padding + (1 - (y - minY) / spanY) * (h - padding * 2);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${px(x).toFixed(2)} ${py(ys[i]).toFixed(2)}`).join(" ");
  const last = ys[ys.length - 1];
  const prev = ys.length > 1 ? ys[ys.length - 2] : last;
  const delta = last - prev;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm opacity-70">Price (sparkline)</div>
        <div className="text-sm">
          <span className="font-semibold">${fmt(last, 6)}</span>
          <span className={`ml-2 text-xs ${delta > 0 ? "text-emerald-300" : delta < 0 ? "text-red-300" : "opacity-70"}`}>
            {delta > 0 ? "+" : delta < 0 ? "−" : ""}{fmt(Math.abs(delta), 6)}
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[120px]">
        <path d={d} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={strokeWidth + 2} />
        <path d={d} fill="none" stroke="white" strokeOpacity="0.9" strokeWidth={strokeWidth} />
        <circle cx={px(xs[xs.length - 1])} cy={py(last)} r="3.5" fill="white" />
      </svg>
    </div>
  );
}

/* ============ ERC20 + Pricing helpers ============ */

const ERC20_MIN_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

async function readErc20Balance(tokenAddress, walletAddress, provider) {
  try {
    const c = new ethers.Contract(tokenAddress, ERC20_MIN_ABI, provider);
    const [rawBal, dec] = await Promise.all([c.balanceOf(walletAddress), c.decimals().catch(() => 18)]);
    const balance = Number(ethers.formatUnits(rawBal, dec));
    return { balance, decimals: dec };
  } catch {
    return { balance: 0, decimals: 18 };
  }
}

async function fetchTokenPriceUsd(tokenAddress) {
  try {
    const json = await fetchJson(DEXSCREENER_TOKEN_URL(tokenAddress));
    const p = json?.pairs?.[0]?.priceUsd ?? json?.priceUsd;
    const num = Number(p);
    return Number.isFinite(num) ? num : null;
  } catch {
    return null;
  }
}

async function fetchMoralisErc20sForWallet(walletAddress) {
  const key = import.meta.env.VITE_MORALIS_KEY;
  if (!key) return null;
  try {
    const url = `${MORALIS_BASE}/${walletAddress}/erc20?chain=cronos`;
    const res = await fetchJson(url, { headers: { "X-API-Key": key } }, 12000);
    if (!Array.isArray(res)) return null;
    return res.map((t) => ({
      address: (t.token_address || t.tokenAddress || "").toLowerCase(),
      balanceRaw: t.balance || "0",
      decimals: Number(t.decimals ?? 18),
      usdPrice: Number(t.usd_price ?? t.usdPrice ?? NaN),
      symbol: t.symbol || "",
      name: t.name || "",
    }));
  } catch {
    return null;
  }
}

/* ============ STAKING ADAPTER EXECUTION ============ */

// ABIs (add the no-pid userInfo variant)
const ABI_BALANCEOF = [
  "function balanceOf(address) view returns (uint256)",
];
// classic MasterChef
const ABI_USERINFO_CLASSIC = [
  "function userInfo(uint256,address) view returns (uint256 amount, uint256 rewardDebt)"
];
// single-pool style (no pid)
const ABI_USERINFO_NOPID = [
  "function userInfo(address) view returns (uint256 amount, uint256 rewardDebt)",
  "function userInfo(address) view returns (uint256)", // sometimes just amount
];
const ABI_LOCKED = [
  "function locked(address) view returns (uint256 amount, uint256 end)",
  "function locked(address) view returns (uint256)", // some lockers just return amount
  "function lockedBalances(address) view returns (uint256 total, uint256 unlockable, uint256 locked, tuple(uint256 amount,uint256 unlockTime)[] locks)"
];
// ERC-4626 style vaults (common for “vault” staking)
const ABI_4626 = [
  "function balanceOf(address) view returns (uint256)",
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function previewRedeem(uint256 shares) view returns (uint256)",
];

async function tryUserInfoClassic(contract, poolId, wallet) {
  try {
    const ui = await contract.userInfo(poolId, wallet);
    const amount = Array.isArray(ui) ? (ui[0] ?? ui.amount ?? ui) : (ui?.amount ?? ui);
    if (amount != null) return amount;
  } catch {}
  return null;
}

async function tryUserInfoNoPid(contract, wallet) {
  try {
    const ui = await contract.userInfo(wallet);
    const amount = Array.isArray(ui) ? (ui[0] ?? ui.amount ?? ui) : (ui?.amount ?? ui);
    if (amount != null) return amount;
  } catch {}
  return null;
}

async function readStakedAmount(adapter, wallet, provider) {
  // Merge ABIs so any function that exists can be called
  const contract = new ethers.Contract(
    adapter.contract,
    [
      ...ABI_BALANCEOF,
      ...ABI_USERINFO_CLASSIC,
      ...ABI_USERINFO_NOPID,
      ...ABI_LOCKED,
      ...ABI_4626,
    ],
    provider
  );

  try {
    if (adapter.type === "balanceOf") {
      const v = await contract.balanceOf(wallet);
      return Number(ethers.formatUnits(v, adapter.asset.decimals));
    }

    if (adapter.type === "chef") {
      const dec = adapter.asset.decimals;

      // 1) try explicit pid (if provided)
      let amountBn = null;
      const hasPoolId = Number.isFinite(adapter.poolId);
      if (hasPoolId) {
        amountBn = await tryUserInfoClassic(contract, adapter.poolId, wallet);
      }

      // 2) if explicit pid missing/wrong → try no-pid userInfo(address)
      if (amountBn == null) {
        amountBn = await tryUserInfoNoPid(contract, wallet);
      }

      // 3) if still null → autoscan a few poolIds (0..9)
      if (amountBn == null) {
        for (let pid = 0; pid < 10; pid++) {
          const v = await tryUserInfoClassic(contract, pid, wallet);
          if (v && v !== 0n) {
            amountBn = (amountBn ?? 0n) + BigInt(v);
          }
        }
      }

      // 4) last fallback → some “chefs” track staked shares via balanceOf
      if (amountBn == null || amountBn === 0n) {
        try {
          const bal = await contract.balanceOf(wallet);
          if (bal && bal !== 0n) amountBn = bal;
        } catch {}
      }

      const amount = Number(ethers.formatUnits(amountBn ?? 0n, dec));
      return amount;
    }

    if (adapter.type === "locked") {
      // unchanged...
      let res;
      try { res = await contract.locked(wallet); } catch {}
      if (res != null) {
        const amount = Array.isArray(res) ? res[0] : res;
        return Number(ethers.formatUnits(amount || 0, adapter.asset.decimals));
      }
      try {
        const lb = await contract.lockedBalances(wallet);
        const total = Array.isArray(lb) ? lb[0] : lb?.total;
        return Number(ethers.formatUnits(total || 0, adapter.asset.decimals));
      } catch {}
      return 0;
    }

    if (adapter.type === "vault4626") {
      // unchanged...
      const shares = await contract.balanceOf(wallet);
      if (!shares) return 0;
      let assets = null;
      try { assets = await contract.convertToAssets(shares); } catch {}
      if (assets == null) {
        try { assets = await contract.previewRedeem(shares); } catch {}
      }
      const v = assets ?? shares;
      return Number(ethers.formatUnits(v, adapter.asset.decimals));
    }

    return 0;
  } catch {
    return 0;
  }
}

async function computeStakedForWallets(wallets, provider) {
  const priceCache = {};
  // cache prices for each underlying asset once
  for (const a of STAKING_ADAPTERS) {
    const key = a.asset.address?.toLowerCase();
    if (!key || priceCache[key] !== undefined) continue;
    priceCache[key] = await fetchTokenPriceUsd(key);
    await sleep(120);
  }

  const perWallet = [];
  for (const w of wallets) {
    const rows = [];
    let totalUsd = 0;
    for (const a of STAKING_ADAPTERS) {
      if (!a.contract || a.contract === "0x0000000000000000000000000000000000000000") continue;
      const amount = await readStakedAmount(a, w, provider);
      const price = priceCache[a.asset.address?.toLowerCase()] ?? null;
      const usd = price ? amount * price : 0;
      rows.push({
        label: a.label,
        token: a.asset.symbol,
        amount,
        usd,
        priceUsd: price,
      });
      totalUsd += usd;
    }
    perWallet.push({ address: w, positions: rows, totalUsd });
  }

  // collapses by token
  const totalsByToken = {};
  let grand = 0;
  for (const w of perWallet) {
    for (const p of w.positions) {
      totalsByToken[p.token] = totalsByToken[p.token] || { amount: 0, usd: 0 };
      totalsByToken[p.token].amount += p.amount || 0;
      totalsByToken[p.token].usd += p.usd || 0;
      grand += p.usd || 0;
    }
  }

  return { perWallet, totalsByToken, grandTotalUsd: grand };
}

/* =================== PAGE =================== */

export default function CrooksFinance() {
  const { provider } = useWallet();

// read provider (prefer env RPC; fallback to our CF function)
const [readProvider, setReadProvider] = useState(() => {
  const url =
    (import.meta.env.VITE_RPC_URL || `${window.location.origin}/rpc-cronos`).trim();
  return new ethers.JsonRpcProvider(url, { chainId: 25, name: "cronos" });
});


useEffect(() => {
  if (!readProvider && provider) setReadProvider(provider);
}, [provider, readProvider]);

  // ----- ERC20 base info -----
  const [tokenMeta, setTokenMeta] = useState({ name: "", symbol: "", decimals: 18, totalSupply: 0 });
  const [holders, setHolders] = useState(null);
  const [priceUsd, setPriceUsd] = useState(null);
  const [liquidityUsd, setLiquidityUsd] = useState(null);
  const [fdvUsd, setFdvUsd] = useState(null);

  // Price history
  const [priceSeries, setPriceSeries] = useState([]); // [{p, t}]
  const priceTimer = useRef(null);

  // Treasury / tracked wallets
  const [walletSummaries, setWalletSummaries] = useState([]);
  const [totalWalletUsd, setTotalWalletUsd] = useState(0);
  const [trackedLoading, setTrackedLoading] = useState(false);

  // Staked (protocols)
  const [stakedResult, setStakedResult] = useState(null);
  const [stakedLoading, setStakedLoading] = useState(false);

  // ERC20 meta for our token
  const erc20Abi = [
    "function name() view returns(string)",
    "function symbol() view returns(string)",
    "function decimals() view returns(uint8)",
    "function totalSupply() view returns(uint256)",
  ];
  const tokenRead = useMemo(() => {
    if (!readProvider) return null;
    return new ethers.Contract(TOKEN_ADDRESS, erc20Abi, readProvider);
  }, [readProvider]);

  // --- Load token meta ---
  useEffect(() => {
    (async () => {
      if (!tokenRead) return;
      try {
        const [name, symbol, decimals, supply] = await Promise.all([
          tokenRead.name().catch(() => "Token"),
          tokenRead.symbol().catch(() => "TKN"),
          tokenRead.decimals().catch(() => 18),
          tokenRead.totalSupply().catch(() => 0n),
        ]);
        setTokenMeta({
          name,
          symbol,
          decimals,
          totalSupply: Number(ethers.formatUnits(supply, Number(decimals || 18))),
        });
      } catch {}
    })();
  }, [tokenRead]);

// --- Holders (Cronos Explorer; try multiple paths + fail gracefully) ---
useEffect(() => {
  (async () => {
    const data = await fetchMoralisTokenData(TOKEN_ADDRESS);
    if (!data) return;
    setTokenMeta(prev => ({
      ...prev,
      name: prev.name || data.name || prev.name,
      symbol: prev.symbol || data.symbol || prev.symbol,
      decimals: data.decimals ?? prev.decimals,
    }));
    // holders is not provided by Moralis v2.2 here → leave as is
  })();
}, []);


  // --- Price poll + series (Dexscreener) ---
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      const data = await fetchJson(DEXSCREENER_TOKEN_URL(TOKEN_ADDRESS));
      const best = data?.pairs?.[0];
      const p = Number(best?.priceUsd);
      const liq = Number(best?.liquidity?.usd);
      const fdv = Number(best?.fdv);
      if (!mounted) return;

      if (Number.isFinite(p)) {
        setPriceUsd(p);
        setPriceSeries((prev) => {
          const next = [...prev, { p, t: Date.now() }];
          if (next.length > 300) next.shift();
          return next;
        });
      }
      if (Number.isFinite(liq)) setLiquidityUsd(liq);
      if (Number.isFinite(fdv)) setFdvUsd(fdv);
    };

    poll();
    priceTimer.current = setInterval(poll, 60_000);
    return () => { mounted = false; clearInterval(priceTimer.current); };
  }, []);

  // --- Market cap (assume totalSupply for now) ---
  const marketCap = useMemo(() => {
    if (!priceUsd || !tokenMeta.totalSupply) return null;
    return priceUsd * tokenMeta.totalSupply;
  }, [priceUsd, tokenMeta.totalSupply]);

  /* -------- Wallet ERC-20 + Moralis (tracked + other) -------- */
  async function computeTrackedTokenSummaryForWallets(wallets, providerX, croPrice) {
  const priceCache = {};
  const tokenAddrs = Object.values(TRACKED_TOKENS).map((a) => (a || "").toLowerCase());

  // cache tracked ERC20 prices
  for (const addr of tokenAddrs) {
    if (!addr || addr === "0x0000000000000000000000000000000000000000") { priceCache[addr] = null; continue; }
    priceCache[addr] = await fetchTokenPriceUsd(addr);
    await sleep(120);
  }

  const perWallet = [];
  for (const w of wallets) {
    const summary = { address: w, tokens: {}, totalUsd: 0, otherUsd: 0 };

    // --- CRO (native) ---
    try {
      const wei = await providerX.getBalance(w);
      const cro = Number(ethers.formatEther(wei)); // CRO amount
      const croUsd = (croPrice && Number.isFinite(cro)) ? cro * croPrice : 0;
      summary.tokens.CRO = { balance: cro, usd: croUsd, priceUsd: croPrice ?? null, addr: "native" };
      summary.totalUsd += croUsd;
    } catch {
      summary.tokens.CRO = { balance: 0, usd: 0, priceUsd: croPrice ?? null, addr: "native" };
    }

    // --- tracked ERC20s (MOON/LION/FUL etc) ---
    for (const [sym, addrRaw] of Object.entries(TRACKED_TOKENS)) {
      const addr = (addrRaw || "").toLowerCase();
      if (!addr || addr === "0x0000000000000000000000000000000000000000") {
        summary.tokens[sym] = { balance: 0, usd: 0, priceUsd: null, addr };
        continue;
      }
      const { balance } = await readErc20Balance(addr, w, providerX);
      const priceUsd2 = priceCache[addr] ?? null;
      const usd = priceUsd2 ? balance * priceUsd2 : 0;
      summary.tokens[sym] = { balance, usd, priceUsd: priceUsd2, addr };
      summary.totalUsd += usd || 0;
    }

    // --- Moralis: other tokens + double-check tracked ---
    const moralisTokens = await fetchMoralisErc20sForWallet(w);
    if (Array.isArray(moralisTokens)) {
      for (const t of moralisTokens) {
        const a = t.address;
        const isTracked = Object.values(TRACKED_TOKENS).some(x => (x || "").toLowerCase() === a);
        const usdPrice = Number.isFinite(t.usdPrice) ? t.usdPrice : null;
        const bal = Number(ethers.formatUnits(t.balanceRaw, t.decimals || 18));
        if (isTracked) {
          const sym = Object.keys(TRACKED_TOKENS).find(k => (TRACKED_TOKENS[k] || "").toLowerCase() === a);
          if (sym && (!summary.tokens[sym] || summary.tokens[sym].balance === 0)) {
            const price = summary.tokens[sym]?.priceUsd ?? usdPrice ?? null;
            const usdVal = price ? bal * price : 0;
            summary.tokens[sym] = { balance: bal, usd: usdVal, priceUsd: price, addr: a };
            summary.totalUsd += usdVal;
          }
        } else if (usdPrice) {
          summary.otherUsd += bal * usdPrice;
        }
      }
      summary.totalUsd += summary.otherUsd;
    }

    perWallet.push(summary);
  }

  // Rollup totals
  const totals = { byToken: {}, grandTotalUsd: 0, otherUsd: 0 };
  // include CRO in the totals map
  totals.byToken.CRO = { balance: 0, usd: 0 };
  for (const sym of Object.keys(TRACKED_TOKENS)) totals.byToken[sym] = { balance: 0, usd: 0 };
  for (const w of perWallet) {
    for (const [sym, data] of Object.entries(w.tokens)) {
      if (!totals.byToken[sym]) totals.byToken[sym] = { balance: 0, usd: 0 };
      totals.byToken[sym].balance += data.balance || 0;
      totals.byToken[sym].usd += data.usd || 0;
      totals.grandTotalUsd += data.usd || 0;
    }
    totals.otherUsd += w.otherUsd || 0;
    totals.grandTotalUsd += w.otherUsd || 0;
  }

  return { perWallet, totals };
}

// --- CRO price (CoinGecko) ---
const [croUsdPrice, setCroUsdPrice] = useState(null);

useEffect(() => {
  (async () => {
    const p = await fetchCroUsdPrice();
    setCroUsdPrice(p);
  })();
}, []);



  // Run wallets computation
 useEffect(() => {
  (async () => {
    if (!readProvider || croUsdPrice == null) return;
    setTrackedLoading(true);
    try {
      const res = await computeTrackedTokenSummaryForWallets(WALLETS_TO_SUM, readProvider, croUsdPrice);
      setWalletSummaries(res.perWallet);
      setTotalWalletUsd(res.totals.grandTotalUsd || 0);
    } catch (e) {
      console.warn("compute tracked tokens failed", e);
    } finally {
      setTrackedLoading(false);
    }
  })();
}, [readProvider, croUsdPrice]);


  /* -------- Staked (protocol adapters) -------- */
  useEffect(() => {
    (async () => {
      if (!readProvider) return;
      setStakedLoading(true);
      try {
        const res = await computeStakedForWallets(WALLETS_TO_SUM, readProvider);
        setStakedResult(res);
      } catch (e) {
        console.warn("compute staked failed", e);
      } finally {
        setStakedLoading(false);
      }
    })();
  }, [readProvider]);

  /* =================== RENDER =================== */

  return (
    <div
      className="min-h-screen w-full text-neutral-50 relative bg-animated"
      style={{
        backgroundImage: "url('/pictures/crooks-empire-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.35),rgba(0,0,0,0.7))]" />
      <div className="relative max-w-6xl mx-auto p-6">
        {/* HEADER */}
        <div className={`${GLASS} ${SOFT_SHADOW} ${GLASS_HOVER} p-4 md:p-5 flex items-center justify-between gap-4`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Crooks Finance</h1>
            <p className={SUB}>Live token metrics & treasury overview (wallet + staked)</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={BADGE}>
              Token:&nbsp;
              <code className="font-mono">{TOKEN_ADDRESS.slice(0, 6)}…{TOKEN_ADDRESS.slice(-4)}</code>
            </span>
          </div>
        </div>

        {/* TOP STATS */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className={`${GLASS} ${SOFT_SHADOW} p-4`}>
            <div className="text-xs opacity-70">Price (USD)</div>
            <div className="mt-1 text-2xl font-bold">{priceUsd ? `$${fmt(priceUsd, 6)}` : "—"}</div>
          </div>
          <div className={`${GLASS} ${SOFT_SHADOW} p-4`}>
            <div className="text-xs opacity-70">Market Cap</div>
            <div className="mt-1 text-2xl font-bold">{marketCap ? `$${fmt(marketCap, 0)}` : "—"}</div>
            <div className="mt-1 text-[11px] opacity-60">Based on totalSupply</div>
          </div>
          <div className={`${GLASS} ${SOFT_SHADOW} p-4`}>
            <div className="text-xs opacity-70">Holders</div>
            <div className="mt-1 text-2xl font-bold">{holders ?? "—"}</div>
            <div className="mt-1 text-[11px] opacity-60">Moralis</div>
          </div>
          <div className={`${GLASS} ${SOFT_SHADOW} p-4`}>
            <div className="text-xs opacity-70">Liquidity (USD)</div>
            <div className="mt-1 text-2xl font-bold">{liquidityUsd ? `$${fmt(liquidityUsd, 0)}` : "—"}</div>
            <div className="mt-1 text-[11px] opacity-60">Dexscreener</div>
          </div>
          <div className={`${GLASS} ${SOFT_SHADOW} p-4`}>
            <div className="text-xs opacity-70">FDV</div>
            <div className="mt-1 text-2xl font-bold">{fdvUsd ? `$${fmt(fdvUsd, 0)}` : "—"}</div>
            <div className="mt-1 text-[11px] opacity-60">Dexscreener</div>
          </div>
        </div>

        {/* TOKEN DETAILS + CHART */}
        <section className="mt-6 grid md:grid-cols-2 gap-5">
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <h2 className="font-semibold text-lg">Token details</h2>
            <div className="mt-3 text-sm grid grid-cols-1 gap-2">
              <div><span className="opacity-70">Name:</span>&nbsp;{tokenMeta.name || "—"}</div>
              <div><span className="opacity-70">Symbol:</span>&nbsp;{tokenMeta.symbol || "—"}</div>
              <div><span className="opacity-70">Decimals:</span>&nbsp;{tokenMeta.decimals ?? "—"}</div>
              <div><span className="opacity-70">Total Supply:</span>&nbsp;{tokenMeta.totalSupply ? `${fmt(tokenMeta.totalSupply, 0)} ${tokenMeta.symbol}` : "—"}</div>
            </div>
          </div>

          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <h2 className="font-semibold text-lg">Price chart</h2>
            <div className="mt-3">
              <Sparkline data={priceSeries} />
            </div>
            <div className="mt-2 text-[11px] opacity-60">
              Price polled every 60s from Dexscreener. Leave open to build history.
            </div>
          </div>
        </section>

        {/* TREASURY: Wallet-held tokens */}
        <section className="mt-6">
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Wallet holdings (tracked tokens)</h2>
              <div className="text-sm">
                Total:&nbsp;<span className="font-bold">{totalWalletUsd ? `$${fmt(totalWalletUsd, 0)}` : "—"}</span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {trackedLoading && <div className={`${GLASS} p-4`}>Loading tracked tokens…</div>}
              {!trackedLoading && walletSummaries.map((w) => (
                <div key={w.address} className={`${GLASS} p-4`}>
                  <div className="text-xs opacity-70 mb-1">Wallet</div>
                  <div className="font-mono text-sm">{w.address.slice(0, 8)}…{w.address.slice(-6)}</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    {["CRO", ...Object.keys(TRACKED_TOKENS)].map((sym) => {
                        const row = w.tokens[sym] || { balance: 0, usd: 0 };
                        return (
                        <div key={sym}>
                            <div className="opacity-70 text-xs">{sym}</div>
                            <div className="font-semibold">{fmt(row.balance, 4)}</div>
                            <div className="text-xs opacity-70">{row.usd ? `$${fmt(row.usd, 0)}` : "—"}</div>
                        </div>
                        );
                    })}
                    <div>
                        <div className="opacity-70 text-xs">Other tokens (USD)</div>
                        <div className="font-semibold">{w.otherUsd ? `$${fmt(w.otherUsd, 0)}` : "—"}</div>
                    </div>
                    </div>
                  <div className="mt-3 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                  <div className="mt-2 text-sm">
                    Total:&nbsp;<span className="font-bold">{Number.isFinite(w.totalUsd) ? `$${fmt(w.totalUsd, 0)}` : "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TREASURY: Staked balances (protocols) */}
        <section className="mt-6">
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Staked balances (protocols)</h2>
              <div className="text-sm">
                Total:&nbsp;<span className="font-bold">{stakedResult ? `$${fmt(stakedResult.grandTotalUsd, 0)}` : "—"}</span>
              </div>
            </div>

            {stakedLoading && <div className="mt-3">Loading staked positions…</div>}

            {!stakedLoading && stakedResult && (
              <>
                {/* by wallet */}
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {stakedResult.perWallet.map((w) => (
                    <div key={w.address} className={`${GLASS} p-4`}>
                      <div className="text-xs opacity-70 mb-1">Wallet</div>
                      <div className="font-mono text-sm">{w.address.slice(0, 8)}…{w.address.slice(-6)}</div>
                      <div className="mt-3 space-y-2 text-sm">
                        {w.positions.length === 0 && <div className="opacity-70">No adapters configured / no stake detected.</div>}
                        {w.positions.map((p, i) => (
                          <div key={i} className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold">{p.label}</div>
                              <div className="opacity-70 text-xs">{p.token}</div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold">{fmt(p.amount, 4)} {p.token}</div>
                              <div className="text-xs opacity-70">{p.usd ? `$${fmt(p.usd, 0)}` : "—"}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                      <div className="mt-2 text-sm">
                        Total:&nbsp;<span className="font-bold">{`$${fmt(w.totalUsd, 0)}`}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* totals by token */}
                <div className="mt-5">
                  <h3 className="font-semibold mb-2">Staked totals by token</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {Object.entries(stakedResult.totalsByToken).map(([sym, v]) => (
                      <div key={sym} className={`${GLASS} p-3`}>
                        <div className="text-xs opacity-70">{sym}</div>
                        <div className="mt-1 text-lg font-bold">{fmt(v.amount, 4)}</div>
                        <div className="text-xs opacity-70">${fmt(v.usd, 0)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className="mt-3 text-xs opacity-60">
              Configure staking contracts in <code>STAKING_ADAPTERS</code> (address + type + poolId if needed). We read on-chain and value with Dexscreener.
            </div>
          </div>
        </section>

        {/* ACTIONS */}
        <div className="mt-4 flex items-center gap-3">
          <a
            className={BTN_GHOST}
            href={`https://cronos.org/explorer/address/${TOKEN_ADDRESS}`}
            target="_blank" rel="noopener noreferrer"
          >
            View on Cronos Explorer
          </a>
          <a
            className={BTN_PRIMARY}
            href={`https://dexscreener.com/search?q=${TOKEN_ADDRESS}`}
            target="_blank" rel="noopener noreferrer"
          >
            View on Dexscreener
          </a>
        </div>
      </div>
    </div>
  );
}
