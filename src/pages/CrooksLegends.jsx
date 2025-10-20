import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { getEbisuSocket } from "../lib/ebisusSocket";
import { useWallet } from "../context/WalletContext";

// Keep a small rolling feed
const FEED_LIMIT = 12;
const recentKeys = new Map();     // key -> ts (voor snelle drops)
const RECENT_TTL_MS = 10_000;     // binnen 10s dezelfde key? overslaan

function addToFeed(setter, item) {
  const key = item.dedupeKey || (
    item.listingId ??
    `${item.type}:${(item.nftAddress || "").toLowerCase()}:${item.nftId}:${item.priceWei || item.price || ""}:${item.time || 0}`
  );

  const now = Date.now();
  const last = recentKeys.get(key);
  if (last && now - last < RECENT_TTL_MS) return;  // drop snelle dubbel
  recentKeys.set(key, now);

  setter(prev => {
    // verwijder oude met dezelfde key & prepend nieuwe
    const filtered = prev.filter(x => x.dedupeKey !== key);
    const next = [{ ...item, dedupeKey: key }, ...filtered];
    return next.slice(0, FEED_LIMIT);
  });
}

function timeAgo(sec) {
  if (!sec) return "";
  const diff = Math.max(0, Date.now()/1000 - sec);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

/**
 * Crooks Finance — CRKL Rewards Dapp
 * Chain: Cronos Mainnet (25)
 * NFT: 0x44102b7ab3e2b8edf77d188cd2b173ecbda60967
 * Distributor: 0x622d5BD30deCe7e12743E988b844bce4AFF0294c
 * Weights JSON: /weights.json
 */

// ===== Chain config =====
const CRONOS_PARAMS = {
  chainId: "0x19",
  chainName: "Cronos Mainnet",
  nativeCurrency: { name: "CRO", symbol: "CRO", decimals: 18 },
  rpcUrls: ["https://evm.cronos.org"],
  blockExplorerUrls: ["https://cronoscan.com"],
};

const DISTRIBUTOR_ADDRESS = "0x622d5BD30deCe7e12743E988b844bce4AFF0294c";
const NFT_ADDRESS = "0x44102b7ab3e2b8edf77d188cd2b173ecbda60967";
const WEIGHTS_JSON_URL = "/weights.json";
const FALLBACK_REWARD_TOKEN = "0x46E2B5423F6ff46A8A35861EC9DAfF26af77AB9A"; // MOON fallback

// ===== UI assets & helpers =====
const PLACEHOLDER_SRC = "/pictures/satoshi.png"; // onze placeholder voor alle NFT tiles
const BG_IMAGE = "/pictures/crooks-empire-bg.png";


// Glass card + ring helper
const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const GLASS_HOVER = "hover:bg-white/10 hover:border-white/20 transition";
const SOFT_SHADOW = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const GLASS_BORDER = "relative overflow-hidden rounded-2xl before:absolute before:inset-0 before:rounded-[inherit] before:p-[1px] before:bg-[conic-gradient(from_180deg_at_50%_0%,rgba(255,255,255,0.18),rgba(255,255,255,0.04),rgba(16,185,129,0.18),rgba(255,255,255,0.12))] after:absolute after:inset-[1px] after:rounded-[inherit] after:bg-[rgba(12,12,14,0.40)] after:backdrop-blur-md";


// Button styles
const BTN = "inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium transition";
const BTN_PILL = `${BTN} bg-neutral-900/70 text-white border border-white/10 hover:bg-neutral-900/50`;
const BTN_BASE = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60";
const BTN_PRIMARY = `${BTN_BASE} bg-emerald-500 text-black hover:bg-emerald-400 shadow-[0_0_0_0_rgba(16,185,129,0.4)] hover:shadow-[0_0_30px_4px_rgba(16,185,129,0.15)]`;
const BTN_GHOST   = `${BTN_BASE} bg-white/8 hover:bg-white/14 border border-white/12`;


// Metric text
const H1 = "text-3xl md:text-4xl font-bold tracking-tight";
const SUB = "text-sm md:text-base opacity-80";

// quick number prettifier
const fmt = (n, d=2) => {
  const x = Number(n);
  if (!isFinite(x)) return String(n);
  if (Math.abs(x) >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: d });
  return x.toFixed(d);
};

// === tiny helpers ===
const copy = (t) => navigator.clipboard?.writeText(t).catch(() => {});
const BADGE = "inline-flex items-center gap-2 rounded-xl px-2 py-1 bg-white/8 border border-white/10 text-xs";




// ===== ABIs =====
const distributorAbi = [
  "function pending(uint256 tokenId,uint256 weight,bytes32[] proof) view returns(bool,uint256)",
  "function claim(uint256 tokenId,uint256 weight,bytes32[] proof)",
  "function claimMany(uint256[] tokenIds,uint256[] weights,bytes32[][] proofs)",
  "function reward() view returns(address)",
  "event Claimed(address indexed to,uint256 indexed tokenId,uint256 amount)",
  "event ClaimedMany(address indexed to,uint256 count,uint256 total)",
];
const erc721Abi = [
  "function ownerOf(uint256) view returns(address)",
  "function balanceOf(address) view returns(uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns(uint256)",
  "function supportsInterface(bytes4) view returns(bool)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
  "function tokenURI(uint256 tokenId) view returns(string)",
];
const erc20Abi = [
  "function symbol() view returns(string)",
  "function decimals() view returns(uint8)",
];

// ===== IPFS helpers & config =====
// Ebisu's Bay eerst, daarna andere publieke gateways
const IPFS_GATEWAYS = [
  "https://ipfs.ebisusbay.com/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/",
  "https://nftstorage.link/ipfs/",
];

// roteer naar de volgende gateway voor dezelfde IPFS-path
function nextGatewayUrl(currentSrc) {
  const m = currentSrc.match(/\/ipfs\/(.+)$/i);
  if (!m || !m[1]) return null;
  const path = m[1];
  const i = IPFS_GATEWAYS.findIndex((g) => currentSrc.startsWith(g));
  const next = IPFS_GATEWAYS[(i + 1) % IPFS_GATEWAYS.length];
  const candidate = `${next}${path}`;
  return candidate !== currentSrc ? candidate : null;
}

// 1) probeer .png ⇄ .webp wissel op dezelfde gateway
function togglePngWebp(url) {
  if (url.endsWith(".png")) return url.slice(0, -4) + ".webp";
  if (url.endsWith(".webp")) return url.slice(0, -5) + ".png";
  return null;
}

// Optional override via env (e.g. VITE_NFT_IMAGE_BASE=https://ipfs.ebisusbay.com/ipfs/<CID>)
const ENV_IMAGE_BASE = (import.meta.env.VITE_NFT_IMAGE_BASE || "").trim();

// Known Crooks image CID (pattern: ipfs://CID/<id>.png)
const IMAGE_BASE_CID = ""; // tijdelijk uit: we willen eerst echte URLs (Moralis/metadata) zien


// ipfs://...  ->  http(s) via the first gateway in IPFS_GATEWAYS
function ipfsToHttp(u, gatewayBase = IPFS_GATEWAYS[0]) {
  if (!u || !u.startsWith("ipfs://")) return u;
  const stripped = u.replace("ipfs://ipfs/", "").replace("ipfs://", "");
  return `${gatewayBase}${stripped}`;
}

// Normalize various media URLs
function resolveMediaUrl(u) {
  if (!u) return null;
  if (u.startsWith("ipfs://")) return ipfsToHttp(u);
  if (u.startsWith("ar://")) return `https://arweave.net/${u.slice(5)}`;
  return u; // http(s) or data:
}

// Build image URL from base (ENV wins; else fixed CID)
function buildImageFromBase(id, gatewayBase = IPFS_GATEWAYS[0]) {
  if (ENV_IMAGE_BASE) {
    const base = ENV_IMAGE_BASE.replace(/\/+$/, "");
    if (base.startsWith("ipfs://")) {
      const stripped = base.replace("ipfs://ipfs/", "").replace("ipfs://", "");
      return `${gatewayBase}${stripped}/${id}.png`;
    }
    return `${base}/${id}.png`;
  }
  return `${gatewayBase}${IMAGE_BASE_CID}/${id}.png`;
}

const RANKS_CANDIDATES = [
  "/ranks.json",
  "/rankings.json",
  "/crooks_ranks.json",
  "/ranks.csv",
  "/crooks_ranks.csv"
];

function tryParseRanksJSON(obj) {
  // Accept either { "123": 45, ... } or [{id:123, rank:45}, ...]
  const map = {};
  if (Array.isArray(obj)) {
    for (const r of obj) {
      const id = Number(r?.id ?? r?.tokenId ?? r?.token_id);
      const rank = Number(r?.rank ?? r?.rarity_rank ?? r?.rarityRank);
      if (Number.isFinite(id) && Number.isFinite(rank)) map[id] = rank;
    }
  } else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      const rank = Number(
        typeof v === "object" ? (v.rank ?? v.rarity_rank ?? v.rarityRank) : v
      );
      if (Number.isFinite(id) && Number.isFinite(rank)) map[id] = rank;
    }
  }
  return map;
}

function tryParseRanksCSV(text) {
  // expects headers containing id|tokenId and rank|rarity_rank
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return {};
  const head = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const idIdx = head.findIndex((h) => /^(id|tokenid|token_id)$/.test(h));
  const rankIdx = head.findIndex((h) => /^(rank|rarity_rank|rarityrank)$/.test(h));
  if (idIdx < 0 || rankIdx < 0) return {};
  const map = {};
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((s) => s.trim());
    const id = Number(cols[idIdx]);
    const rank = Number(cols[rankIdx]);
    if (Number.isFinite(id) && Number.isFinite(rank)) map[id] = rank;
  }
  return map;
}



// ===== Tunables =====
const PENDING_CONCURRENCY = 6;
const PENDING_BATCH_PAUSE_MS = 150;
const OWNEROF_CONCURRENCY = 25;
const OWNEROF_BATCH_DELAY_MS = 120;
const BLOCK_CHUNK = 10_000n;
const START_BLOCK_HINT = 5_677_593n;
const TOKENIMAGE_CONCURRENCY = 10;
const EBISUS_LINK = "https://app.ebisusbay.com/collection/cronos/crooks-legends?chain=cronos";



// ===== Small utilities =====
const MORALIS_BASE = "https://deep-index.moralis.io/api/v2.2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const formatUnits = (v, d) => { try { return ethers.formatUnits(v, d); } catch { return v?.toString?.() ?? "0"; } };
function chunk(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }

// Promise pool
async function pPool(items, limit, worker) {
  const ret = [];
  let i = 0, active = 0, done = 0;
  return new Promise((resolve) => {
    const next = () => {
      if (done === items.length) return resolve(ret);
      while (active < limit && i < items.length) {
        const idx = i++, item = items[idx];
        active++;
        Promise.resolve(worker(item, idx))
          .then((r) => ret[idx] = r)
          .catch(() => ret[idx] = undefined)
          .finally(() => { active--; done++; next(); });
      }
    };
    next();
  });
}

// fetch JSON with timeout (supports data: URLs)
async function fetchJsonWithTimeout(url, ms = 8000) {
  if (url.startsWith("data:")) {
    try {
      const [, b64] = url.split(",");
      if (!b64) return null;
      return JSON.parse(atob(b64)) || null;
    } catch { return null; }
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, mode: "cors" });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(t); }
}

// Moralis helpers
function moralisCacheKey(address, weightsRoot) {
  return `moralis:${address.toLowerCase()}:${weightsRoot || "no-root"}:${NFT_ADDRESS.toLowerCase()}`;
}
function saveCache(key, ids) { try { localStorage.setItem(key, JSON.stringify({ ids, ts: Date.now() })); } catch {} }
function loadCache(key, maxAgeMs = 60 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.ids)) return null;
    if (Date.now() - (parsed.ts || 0) > maxAgeMs) return null;
    return parsed.ids;
  } catch { return null; }
}
async function moralisFetch(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url, opts); if (res.ok) return res.json(); } catch {}
    await sleep(300 * Math.pow(2, i));
  }
  return null;
}

async function discoverOwnedViaMoralis(owner, weights) {
  const apiKey = import.meta.env.VITE_MORALIS_KEY;
  if (!apiKey) return null;

  const cacheKey = moralisCacheKey(owner, weights?.root);
  const cached = loadCache(cacheKey);
  if (cached) {
    const filtered = cached.filter((id) => !!weights?.tokens?.[String(id)]).sort((a, b) => a - b);
    return { ids: filtered, images: {} };
  }

  let cursor = null;
  const pageLimit = 100;
  const ids = [];
  const images = {};

  for (let page = 0; page < 20; page++) {
    const url = new URL(`${MORALIS_BASE}/${owner}/nft`);
    url.searchParams.set("chain", "cronos");
    url.searchParams.set("format", "decimal");
    url.searchParams.set("limit", String(pageLimit));
    url.searchParams.set("token_addresses", NFT_ADDRESS);
    url.searchParams.set("normalizeMetadata", "true");
    url.searchParams.set("media_items", "true");
    if (cursor) url.searchParams.set("cursor", cursor);

    const data = await moralisFetch(url.toString(), { headers: { "X-API-Key": apiKey } });
    if (page === 0 && data && Array.isArray(data.result)) {
      console.debug("[moralis result sample] discoverOwnedViaMoralis:", data.result.slice(0, 2));
    }
    if (!data || !Array.isArray(data.result)) break;

    for (const r of data.result) {
      const n = Number(r.token_id);
      if (!Number.isFinite(n)) continue;

      // --- verbeterde image-extractie ---
      let image = null;

      // 1) Genormaliseerd veld van Moralis
      if (r.normalized_metadata?.image) image = r.normalized_metadata.image;

      // 2) Moralis media resolver
      if (!image && Array.isArray(r.media) && r.media.length) {
        image =
          r.media[0].gateway_media_url ||    // CDN/gateway
          r.media[0].original_media_url ||   // ipfs:// of ar://
          null;
      }

      // 3) Ruwe metadata
      if (!image) {
        try {
          const meta = r.metadata ? JSON.parse(r.metadata) : null;
          image =
            meta?.image ||
            meta?.image_url ||
            meta?.animation_url ||
            null;
        } catch {}
      }

      // 4) Normaliseer naar http(s)
      if (image) images[n] = resolveMediaUrl(image);
    }



    if (!data.cursor) break;
    cursor = data.cursor;
  }

  ids.sort((a, b) => a - b);
  saveCache(cacheKey, ids);

  const filtered = ids.filter((id) => !!weights?.tokens?.[String(id)]);
  const filteredImages = {};
  for (const id of filtered) if (images[id]) filteredImages[id] = images[id];

  return { ids: filtered, images: filteredImages };
}

async function ownerOfSafe(c, id) {
  try { return await c.ownerOf(id); }
  catch { await sleep(80); try { return await c.ownerOf(id); } catch { return null; } }
}

async function discoverOwnedViaOwnerOf(nftReadOnly, owner, weights) {
  const tokenKeys = Object.keys(weights?.tokens || {});
  if (tokenKeys.length === 0) return [];

  let target = 0n; try { target = await nftReadOnly.balanceOf(owner); } catch {}

  const idsSorted = tokenKeys.map(Number).sort((a, b) => a - b);
  const batches = chunk(idsSorted, OWNEROF_CONCURRENCY);
  const found = new Set();

  for (const b of batches) {
    await Promise.allSettled(b.map(async (id) => {
      const o = await ownerOfSafe(nftReadOnly, id);
      if (o && o.toLowerCase() === owner.toLowerCase()) found.add(id);
    }));
    if (target > 0n && BigInt(found.size) >= target) break;
    await sleep(OWNEROF_BATCH_DELAY_MS);
  }
  return Array.from(found).sort((a, b) => a - b);
}

async function hydrateImagesViaMoralisWalletView(owner, setTokenImages) {
  const apiKey = import.meta.env.VITE_MORALIS_KEY;
  if (!apiKey || !owner) return;

  let cursor = null;
  const pageLimit = 100;
  const images = {};

  for (let page = 0; page < 10; page++) {
    const url = new URL(`${MORALIS_BASE}/${owner}/nft`);
    url.searchParams.set("chain", "cronos");
    url.searchParams.set("format", "decimal");
    url.searchParams.set("limit", String(pageLimit));
    url.searchParams.set("token_addresses", NFT_ADDRESS);
    url.searchParams.set("normalizeMetadata", "true");
    url.searchParams.set("media_items", "true");
    if (cursor) url.searchParams.set("cursor", cursor);

    const data = await moralisFetch(url.toString(), { headers: { "X-API-Key": apiKey } });
    if (page === 0 && data && Array.isArray(data.result)) {
      console.debug("[moralis result sample] hydrateImagesViaMoralisWalletView:", data.result.slice(0, 2));
    }

    if (!data || !Array.isArray(data.result)) break;

    for (const r of data.result) {
      const n = Number(r.token_id);
      if (!Number.isFinite(n)) continue;

      // -------------------------------
      // 🔧 Nieuwe image-extractie
      // -------------------------------
      let image = null;

      // 1) genormaliseerd veld van Moralis (meestal direct bruikbaar)
      if (r.normalized_metadata?.image) image = r.normalized_metadata.image;

      // 2) Moralis media resolver (handig als metadata vaag is)
      if (!image && Array.isArray(r.media) && r.media.length) {
        image =
          r.media[0].gateway_media_url ||    // CDN/gateway URL
          r.media[0].original_media_url ||   // originele bron (kan ipfs:// of ar:// zijn)
          null;
      }

      // 3) ruwe metadata van het token (fallback)
      if (!image) {
        try {
          const meta = r.metadata ? JSON.parse(r.metadata) : null;
          image =
            meta?.image ||
            meta?.image_url ||
            meta?.animation_url ||
            null;
        } catch {}
      }

      // 4) resolve ipfs:// en ar:// naar http(s)
      if (image) images[n] = resolveMediaUrl(image);

      ids.push(n);
    }


    if (!data.cursor) break;
    cursor = data.cursor;
  }

  if (Object.keys(images).length) setTokenImages(prev => ({ ...prev, ...images }));
}

async function hydrateImagesViaTokenURI(nftReadOnly, ids, setTokenImages) {
  if (!nftReadOnly || !ids?.length) return;

  // 1) read tokenURI in parallel
  const uris = await pPool(ids, TOKENIMAGE_CONCURRENCY, async (id) => {
    try { return await nftReadOnly.tokenURI(id); } catch { return null; }
  });

  if (import.meta.env.MODE !== "production") {
    const sample = uris.find(Boolean);
    console.debug("[tokenURI] sample:", sample);
  }

  // 2) fetch metadata JSON
  const metas = await pPool(ids, TOKENIMAGE_CONCURRENCY, async (_, idx) => {
    const uri = uris[idx];
    if (!uri) return null;
    const jsonUrl = resolveMediaUrl(uri);
    if (!jsonUrl) return null;
    return await fetchJsonWithTimeout(jsonUrl);
  });

  // 3) extract images
  const update = {};
  ids.forEach((id, idx) => {
    const m = metas[idx];
    let img =
      m?.image ??
      m?.image_url ??
      m?.imageURI ??
      m?.animation_url ??
      (typeof m?.properties === "object" ? (m.properties.image || m.properties.image_url) : null) ??
      (typeof m?.meta === "object" ? (m.meta.image || m.meta.image_url) : null) ??
      (typeof m?.data === "object" ? (m.data.image || m.data.image_url) : null) ??
      null;
    if (img) update[id] = resolveMediaUrl(img);
  });

  if (Object.keys(update).length) {
    setTokenImages((prev) => ({ ...prev, ...update }));
  }
  if (import.meta.env.MODE !== "production") {
    console.debug("[images] tokenURI resolved:", Object.keys(update).length);
  }
}

export default function CrooksRewardsDapp() {
  const [ranksById, setRanksById] = useState({}); // { [tokenId:number]: rank:number }
  const [rankMax, setRankMax] = useState("");     // (reserved for UI filter)
  const [sortBy, setSortBy] = useState("id");     // (reserved for UI sort)
  const [ebisuFeed, setEbisuFeed] = useState([]); // recent sales/listings
  const { provider, signer, address, networkOk } = useWallet();


// 🔁 LIVE MARKET FEED (SSE via local relay)
useEffect(() => {
  const addr = NFT_ADDRESS.toLowerCase();
  const FEED_BASE = import.meta.env.VITE_EBISUS_FEED_URL || ""; // bv. https://feed.crooks.finance/events
  const es = FEED_BASE ? new EventSource(`${FEED_BASE}?addr=${addr}`) : null;
  if (!es) return; // geen feed geconfigureerd → sla over


  const normalize = (type, ev) => {
  const nft = ev?.nft || ev;

  const rawId = String(
    ev?.nftId ?? ev?.tokenId ?? ev?.edition ??
    nft?.nftId ?? nft?.tokenId ?? nft?.edition ?? ""
  );

  const addrRaw = nft?.nftAddress || ev?.nftAddress || "";
  const ts = Number(ev?.saleTime || ev?.listingTime || ev?.time || 0); // géén Date.now()

  const permalink =
    nft?.market_uri ||
    (addrRaw && rawId
      ? `https://app.ebisusbay.com/collection/${addrRaw}/${rawId}`
      : "");

  // Stabiele sleutel: voorkeur listingId > txHash > tuple
  const dedupeKey =
    String(
      ev?.listingId ??
      ev?.txHash ??
      `${type}|${addrRaw.toLowerCase()}|${rawId}|${ev?.priceWei ?? ev?.price ?? ""}|${ts}`
    );

  return {
    type,
    listingId: ev?.listingId,
    nftId: rawId,
    nftAddress: addrRaw,         // voor URL intact laten
    name: nft?.name || (rawId ? `#${rawId}` : ""),
    image: nft?.image || nft?.original_image || PLACEHOLDER_SRC,
    price: ev?.price ?? (ev?.priceWei ? Number(ethers.formatUnits(ev.priceWei, 18)).toFixed(2) : undefined),
    time: ts,                    // 0 als onbekend (geen “nu”)
    uri: permalink,
    dedupeKey,                   // ⬅ gebruiken we zo
  };
};

  const handle = (type) => (evt) => {
    try {
      const payload = JSON.parse(evt.data);
      addToFeed(setEbisuFeed, normalize(type, payload));
    } catch {}
  };

  es.addEventListener("listed", handle("Listed"));
  es.addEventListener("sold", handle("Sold"));
  es.onerror = (e) => console.warn("[ebisus] sse error", e);

  // ⬇️ cleanup: sluit alleen als es bestaat (null-safe)
  return () => {
    try { es?.close(); } catch {}
  };
}, []);



// Read-only RPC via env; valt terug op wallet provider
const [readProvider, setReadProvider] = useState(() => {
  const rpc = import.meta.env.VITE_RPC_URL;            // ← bv. jouw Ankr/QuickNode endpoint
  return rpc ? new ethers.JsonRpcProvider(rpc) : null;
});

useEffect(() => {
  // Als er (nog) geen readProvider is maar de wallet-provider wel beschikbaar is,
  // gebruik dan die als fallback zodat reads gewoon werken.
  if (!readProvider && provider) setReadProvider(provider);
}, [provider, readProvider]);



  const [weights, setWeights] = useState({ root: "", totalWeight: "0", tokens: {} });
  const [rewardToken, setRewardToken] = useState({ address: FALLBACK_REWARD_TOKEN, symbol: "?", decimals: 18 });
  const [nftMeta, setNftMeta] = useState({ name: "NFT", symbol: "" });

  const [ownedTokenIds, setOwnedTokenIds] = useState([]);
  const [manualTokenIds, setManualTokenIds] = useState("");
  const [pendingById, setPendingById] = useState({});
  const [tokenImages, setTokenImages] = useState({});
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [history, setHistory] = useState([]);
  const [showDetails, setShowDetails] = useState(false);


 // debug: how many images have been resolved, show sample URL if any
useEffect(() => {
  if (!address) return;
  const count = Object.keys(tokenImages).length;
  console.debug("[images] resolved count:", count);
  if (count) {
    const sampleEntry = Object.entries(tokenImages)[0];
    if (sampleEntry) console.debug("[images] sample URL:", sampleEntry[1]);
  } else {
    console.debug("[images] hints:", {
      hasMoralisKey: !!import.meta.env.VITE_MORALIS_KEY,
      enumerableTried: true,
    });
  }
}, [address, tokenImages]);

  // Contracts
  const distributorRead = useMemo(() => {
    if (!readProvider) return null;
    return new ethers.Contract(DISTRIBUTOR_ADDRESS, distributorAbi, readProvider);
  }, [readProvider]);

  const nftReadOnly = useMemo(() => {
    if (!readProvider) return null;
    return new ethers.Contract(NFT_ADDRESS, erc721Abi, readProvider);
  }, [readProvider]);


  // Load weights.json
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(WEIGHTS_JSON_URL, { cache: "no-store" });
        if (res.ok) setWeights(await res.json());
      } catch (e) { console.warn("Failed to fetch weights.json", e); }
    })();
  }, []);

  // Load ranks.json or ranks.csv (for NFT rank info)
  useEffect(() => {
    (async () => {
      for (const path of RANKS_CANDIDATES) {
        try {
          const res = await fetch(path, { cache: "no-store" });
          if (!res.ok) continue;
          const url = new URL(res.url);
          let map = {};
          if (/\.(json)(\?.*)?$/.test(url.pathname)) {
            const json = await res.json();
            map = tryParseRanksJSON(json);
          } else {
            const text = await res.text();
            map = tryParseRanksCSV(text);
          }
          if (Object.keys(map).length) {
            setRanksById(map);
            console.debug("[ranks] loaded", Object.keys(map).length, "items from", path);
            break;
          }
        } catch {}
      }
    })();
  }, []);


  // Read token + NFT metadata
  useEffect(() => {
    (async () => {
      if (!distributorRead) return;
      try {
        const rewardAddr = await distributorRead.reward();
        const erc20 = new ethers.Contract(rewardAddr, erc20Abi, distributorRead.runner);
        const [symbol, decimals] = await Promise.all([
          erc20.symbol().catch(() => "TOKEN"),
          erc20.decimals().catch(() => 18),
        ]);
        setRewardToken({ address: rewardAddr, symbol, decimals });
      } catch {
        const erc20 = new ethers.Contract(FALLBACK_REWARD_TOKEN, erc20Abi, distributorRead?.runner || readProvider);
        const [symbol, decimals] = await Promise.all([
          erc20.symbol().catch(() => "TOKEN"),
          erc20.decimals().catch(() => 18),
        ]);
        setRewardToken({ address: FALLBACK_REWARD_TOKEN, symbol, decimals });
      }
      try {
        const [name, symbol] = await Promise.all([
          nftReadOnly?.name?.().catch(() => "NFT"),
          nftReadOnly?.symbol?.().catch(() => ""),
        ]);
        setNftMeta({ name: name ?? "NFT", symbol: symbol ?? "" });
      } catch {}
    })();
  }, [distributorRead, nftReadOnly, readProvider]);

  // Core: discover NFTs for connected wallet
  async function discoverOwned() {
    if (!weights?.tokens || Object.keys(weights.tokens).length === 0) {
      setStatus("weights.json not loaded yet. Try again in a moment.");
      return;
    }
    if (!readProvider || !address) { setStatus("Connect wallet first."); return; }

    setLoading(true);
    setStatus("Discovering your NFTs…");
    try {
      // Prefer ERC721Enumerable
      const supportsEnumerable = await nftReadOnly.supportsInterface("0x780e9d63").catch(() => false);
      if (supportsEnumerable) {
        const bal = await nftReadOnly.balanceOf(address);
        const n = Number(bal);
        const ids = [];
        for (let i = 0; i < n; i++) ids.push(Number(await nftReadOnly.tokenOfOwnerByIndex(address, i)));
        ids.sort((a, b) => a - b);

        // Only try tokenURI if contract claims metadata support
        const ERC721_METADATA_ID = "0x5b5e139f";
        const supportsMetadata = await nftReadOnly.supportsInterface(ERC721_METADATA_ID).catch(() => true);
        if (supportsMetadata) {
          await hydrateImagesViaTokenURI(nftReadOnly, ids, setTokenImages);
        } else {
          console.debug("[images] tokenURI not supported by contract");
        }

        // Merge Moralis wallet view (if available)
        if (import.meta.env.VITE_MORALIS_KEY) {
          await hydrateImagesViaMoralisWalletView(address, setTokenImages);
        }

        // FINAL FALLBACK: construct <CID>/<id>.png for any still-missing ids
        const missingForBase = ids.filter((id) => !tokenImages[id]);
        if (missingForBase.length && (ENV_IMAGE_BASE || IMAGE_BASE_CID)) {
          const patch = {};
          for (const m of missingForBase) {
            const u = buildImageFromBase(m, IPFS_GATEWAYS[0]);
            if (u) patch[m] = u;
          }
          if (Object.keys(patch).length) {
            setTokenImages((prev) => ({ ...prev, ...patch }));
            console.debug("[images] applied IMAGE_BASE fallback for", Object.keys(patch).length, "ids");
          }
        }

        // Debug info for missing weights
        const missing = ids.filter((id) => !weights?.tokens?.[String(id)]);
        window.__ownedIds = ids; window.__weights = weights; window.__missingInWeights = missing;
        setStatus(missing.length ? `Found ${ids.length} NFTs, but ${missing.length} missing in weights.json.` : "");

        setOwnedTokenIds(ids);
        await refreshPending(ids);
        return;
      }

      // Try Moralis (fast & low RPC)
      setStatus("Checking indexer (Moralis)…");
      const res = await discoverOwnedViaMoralis(address, weights);
      if (res && res.ids.length) {
        const { ids: viaMoralis, images } = res;
        const missing = viaMoralis.filter((id) => !weights?.tokens?.[String(id)]);
        window.__ownedIds = viaMoralis; window.__weights = weights; window.__missingInWeights = missing;
        setStatus(missing.length ? `Found ${viaMoralis.length} NFTs via Moralis, ${missing.length} missing in weights.json.` : "");
        setTokenImages((prev) => ({ ...prev, ...images }));
        setOwnedTokenIds(viaMoralis);
        await refreshPending(viaMoralis);
        return;
      }

      // Fallback: sweep via ownerOf
      setStatus("Sweeping ownerOf (fallback)…");
      const idsFromOwnerOf = await discoverOwnedViaOwnerOf(nftReadOnly, address, weights);
      const missing = idsFromOwnerOf.filter((id) => !weights?.tokens?.[String(id)]);
      window.__ownedIds = idsFromOwnerOf; window.__weights = weights; window.__missingInWeights = missing;
      setStatus(missing.length ? `Found ${idsFromOwnerOf.length} NFTs, ${missing.length} missing in weights.json.` : "");
      setOwnedTokenIds(idsFromOwnerOf);
      await refreshPending(idsFromOwnerOf);
      if (!idsFromOwnerOf.length) setStatus("No NFTs detected. Check weights.json.");
    } catch (e) {
      console.warn(e);
      setStatus("Couldn't discover your NFTs automatically.");
    } finally { setLoading(false); }
  }

  function mergedTokenIds(forcedIds) {
    const manual = manualTokenIds.split(/[, \s]+/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
    const base = forcedIds ?? ownedTokenIds;
    return Array.from(new Set([...base, ...manual]))
      .filter((id) => weights.tokens?.[String(id)])
      .sort((a, b) => a - b);
  }

  async function refreshPending(forcedIds) {
    const ids = mergedTokenIds(forcedIds);
    if (!ids.length || !distributorRead) { setPendingById({}); return; }

    setStatus("Calculating pending rewards…");
    const out = {};
    try {
      const batches = chunk(ids, PENDING_CONCURRENCY);
      for (const batch of batches) {
        await Promise.all(batch.map(async (tokenId) => {
          const entry = weights.tokens[String(tokenId)];
          if (!entry) {
            out[tokenId] = { valid: false, amount: "0", weight: "-", proof: [], error: "Missing in weights.json" };
            return;
          }
          try {
            const [valid, amount] = await distributorRead.pending(tokenId, BigInt(entry.weight), entry.proof);
            out[tokenId] = { valid, amount: amount.toString(), weight: entry.weight.toString(), proof: entry.proof };
          } catch {
            out[tokenId] = { valid: false, amount: "0", weight: entry.weight?.toString?.() ?? "-", proof: entry.proof ?? [], error: "pending() reverted or RPC dropped" };
          }
        }));
        await sleep(PENDING_BATCH_PAUSE_MS);
      }
      setPendingById(out);
      setStatus("");
    } catch (e) {
      console.error(e);
      setStatus("Failed to fetch pending amounts.");
    }
  }

  // Claim one
  async function handleClaimOne(tokenId) {
    if (!provider || !signer) return alert("Connect your wallet first.");
    const info = pendingById[tokenId];
    if (!weights?.tokens?.[String(tokenId)]) return alert(`#${tokenId} is not present in weights.json → no proof/weight.`);
    if (!info || !info.valid) return alert("Invalid or missing proof/weight.");
    if (BigInt(info.amount || "0") === 0n) return alert(`Nothing to claim for #${tokenId}`);

    setClaiming(true);
    setStatus(`Claiming for #${tokenId}…`);
    try {
      const write = new ethers.Contract(DISTRIBUTOR_ADDRESS, distributorAbi, signer);
      const tx = await write.claim(tokenId, BigInt(info.weight), info.proof);
      await tx.wait();
      setStatus("Claimed successfully!");
      await refreshPending();
    } catch (e) { console.error(e); setStatus("Claim failed. Check wallet or gas."); }
    finally { setClaiming(false); }
  }

  // Claim many
  async function handleClaimAll() {
    if (!provider || !signer) return alert("Connect your wallet first.");
    const entries = Object.entries(pendingById).filter(([, v]) => v?.valid && BigInt(v.amount || "0") > 0n);
    if (!entries.length) return alert("No claimable items.");

    const tokenIds = entries.map(([id]) => Number(id));
    const weightsArr = entries.map(([, v]) => BigInt(v.weight));
    const proofsArr = entries.map(([, v]) => v.proof);

    setClaiming(true);
    setStatus("Claiming all selected NFTs…");
    try {
      const write = new ethers.Contract(DISTRIBUTOR_ADDRESS, distributorAbi, signer);
      const tx = await write.claimMany(tokenIds, weightsArr, proofsArr);
      await tx.wait();
      setStatus("Claimed all!");
      await refreshPending();
    } catch (e) { console.error(e); setStatus("ClaimMany failed."); }
    finally { setClaiming(false); }
  }

// Rough block estimate helper (Cronos ~5.7s per block on average)
const blocksFromDays = (days) => BigInt(Math.max(1, Math.floor((days * 86400) / 5.7)));

async function loadHistory({ blocksBack = 500_000n } = {}) {
  if (!readProvider) return;
  setLoading(true);
  setStatus("Fetching claim history…");
  try {
    const latestNum = await readProvider.getBlockNumber();
    const to = BigInt(latestNum);
    const from = to > blocksBack ? to - blocksBack : 0n;

    const iface = new ethers.Interface(distributorAbi);
    const tClaimed = iface.getEvent("Claimed").topicHash;
    const tClaimedMany = iface.getEvent("ClaimedMany").topicHash;

    const [logs1, logs2] = await Promise.all([
      readProvider.getLogs({ address: DISTRIBUTOR_ADDRESS, fromBlock: from, toBlock: to, topics: [tClaimed] }),
      readProvider.getLogs({ address: DISTRIBUTOR_ADDRESS, fromBlock: from, toBlock: to, topics: [tClaimedMany] }),
    ]);

    const rows = [];
    for (const l of logs1) {
      const parsed = iface.parseLog(l);
      rows.push({
        blockNumber: Number(l.blockNumber),
        to: parsed.args[0],
        tokenId: parsed.args[1].toString(),
        amount: parsed.args[2].toString(),
        type: "Claimed",
      });
    }
    for (const l of logs2) {
      const parsed = iface.parseLog(l);
      rows.push({
        blockNumber: Number(l.blockNumber),
        to: parsed.args[0],
        tokenId: "-",
        amount: parsed.args[2].toString(),
        type: "ClaimedMany",
      });
    }

    rows.sort((a, b) => a.blockNumber - b.blockNumber);
    setHistory(rows);
    setStatus(rows.length ? "" : "No claims in the selected range.");
  } catch (e) {
    console.error(e);
    setStatus("Could not load history (try a larger range).");
  } finally {
    setLoading(false);
  }
}


  // UI derived state
  // 1) base ids (owned + manual), limited to those in weights.json
  const baseIds = (() => {
    const manual = manualTokenIds
      .split(/[, \s]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    return Array.from(new Set([...ownedTokenIds, ...manual]))
      .filter((id) => weights.tokens?.[String(id)]);
  })();

  // 2) filter by rank + sort
  const ids = (() => {
    const max = Number(rankMax);
    const filtered = Number.isFinite(max) && max > 0
      ? baseIds.filter((id) => {
          const r = Number(ranksById?.[String(id)] ?? ranksById?.[id]);
          return !Number.isFinite(r) || r <= max; // keep unknown or <= max
        })
      : baseIds.slice();

    if (sortBy === "rank") {
      filtered.sort((a, b) => {
        const ra = Number(ranksById?.[String(a)] ?? ranksById?.[a]);
        const rb = Number(ranksById?.[String(b)] ?? ranksById?.[b]);
        if (Number.isFinite(ra) && Number.isFinite(rb)) return ra - rb;
        if (Number.isFinite(ra)) return -1;
        if (Number.isFinite(rb)) return 1;
        return a - b;
      });
    } else {
      filtered.sort((a, b) => a - b);
    }
    return filtered;
  })();


  // --- Force-fill images from a known base pattern <CID>/<id>.png if still missing
useEffect(() => {
  if (!ids.length) return;
  // build once per render; don't depend on tokenImages changing while we compute
  const missing = ids.filter((id) => !tokenImages[id]);
  if (!missing.length) return;

  // Try ENV base first, otherwise fixed CID we hardcoded
  const canBuild = !!(ENV_IMAGE_BASE || IMAGE_BASE_CID); 
  if (!canBuild) return;

  const patch = {};
  for (const m of missing) {
    const u = buildImageFromBase(m, IPFS_GATEWAYS[0]);
    if (u) patch[m] = u;
  }
  if (Object.keys(patch).length) {
    setTokenImages((prev) => ({ ...prev, ...patch }));
    console.debug("[images] base-fill applied:", Object.keys(patch).length, "ids");
    console.table(Object.entries(patch).slice(0, 8).map(([k, v]) => ({ tokenId: k, url: v })));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ids.join(",")]); // only re-run when the owned id set changes


  const totalPending = Object.values(pendingById).reduce((acc, v) => { try { return acc + BigInt(v?.amount || "0"); } catch { return acc; } }, 0n);

  // --- Dashboard stats for header strip ---
  const ownedCount = ids.length;

  const claimable = (() => {
    try {
      return Object.values(pendingById).filter(
        (v) => v?.valid && BigInt(v.amount || "0") > 0n
      ).length;
    } catch {
      return 0;
    }
  })();

  const totalPendingHuman = formatUnits(
    Object.values(pendingById).reduce((acc, v) => {
      try {
        return acc + BigInt(v?.amount || "0");
      } catch {
        return acc;
      }
    }, 0n),
    rewardToken.decimals
  );


  return (
    <div
      className="min-h-screen w-full text-neutral-50 relative bg-animated"
      style={{
        backgroundImage: `url(${BG_IMAGE})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      {/* overlay gradient voor leesbaarheid */}
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.35),rgba(0,0,0,0.6))]" />
      <div className="relative max-w-6xl mx-auto p-6">
        <header className={`${GLASS} ${SOFT_SHADOW} ${GLASS_HOVER} p-4 md:p-5 flex items-center justify-between gap-4`}>
          <div>
            <h1 className={H1}>
              <span className="bg-gradient-to-r from-white via-white to-emerald-300 bg-clip-text text-transparent">
                Crooks Rewards
              </span>
            </h1>
            <p className={SUB}>Claim MOON 🌖 rewards for your Crooks Legends</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowDetails(true)} className={BTN_GHOST}>Details</button>
            {/* Connect-knop staat nu in de top navbar */}
          </div>
        </header>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: "Owned", value: ownedCount },
            { label: "Claimable", value: claimable },
            { label: `Total Pending (${rewardToken.symbol})`, value: fmt(totalPendingHuman, 4) }
          ].map((s, i) => (
            <div key={i} className={`${GLASS} ${SOFT_SHADOW} p-4`}>
              <div className="text-xs opacity-70">{s.label}</div>
              <div className="mt-1 text-2xl font-bold">{s.value}</div>
              <div className="mt-2 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
            </div>
          ))}
        </div>


        {!networkOk && (
          <div className="mt-4 p-4 bg-red-500/20 border border-red-400/40 rounded-2xl">
            <b>Not on Cronos.</b> Switch to Cronos Mainnet (chainId 25).
          </div>
        )}

        {(!weights?.tokens || Object.keys(weights.tokens).length === 0) && (
          <div className="mt-4 p-4 bg-yellow-500/20 border border-yellow-400/40 rounded-2xl">
            <b>weights.json not yet loaded</b> — please wait a second or refresh.
          </div>
        )}

        <section className="mt-6 grid md:grid-cols-2 gap-5">
            <div className={`${GLASS_BORDER} ${SOFT_SHADOW}`}>
              <div className="relative z-10 p-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-lg">Market</h2>
                  <a
                    href={EBISUS_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={BTN_PRIMARY}
                    title="Open Crooks Legends on Ebisu's Bay"
                  >
                    View on Ebisu’s Bay
                  </a>
                </div>

                {/* Recent sales (placeholder / API-ready) */}
                {/* ✅ LIVE EbisuBay feed */}
                <div className="mt-4">
                  <div className="text-xs opacity-70 mb-2">
                    {ebisuFeed.length ? "Live market activity" : "Waiting for live events…"}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {ebisuFeed.map((ev, i) => {
                      const itemUrl = ev.uri || EBISUS_LINK; // uri komt nu uit normalize()
                      return (
                        <a
                          key={ev.listingId ?? `${ev.type}-${ev.nftId}-${i}`}
                          href={itemUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`${GLASS} p-3 flex items-center gap-3 hover:bg-white/10 transition`}
                          title="View on Ebisu’s Bay"
                        >
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/10 border border-white/10 shrink-0">
                            <img
                              src={ev.image || PLACEHOLDER_SRC}
                              alt={ev.name || (ev.nftId ? `#${ev.nftId}` : "NFT")}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                          <div className="text-xs leading-5 min-w-0">
                            <div className="opacity-90 truncate">
                              {ev.type} • {ev.name || (ev.nftId ? `#${ev.nftId}` : "")}
                            </div>
                            <div className="opacity-70">{ev.price ? `${ev.price} CRO` : ""}</div>
                            <div className="opacity-50">{timeAgo(ev.time || 0)}</div>
                          </div>
                        </a>
                      );
                    })}
                  </div>

                  {!ebisuFeed.length && (
                    <div className="mt-3 text-xs opacity-60">
                      Tip: activity appears when a <b>Listed</b> or <b>Sold</b> event fires for this collection.
                    </div>
                  )}
                </div>

                {/* ✅ END EbisuBay feed */}

              </div>
            </div>




          <div className={`${GLASS_BORDER} ${SOFT_SHADOW} isolate`}>
            <div className="relative z-10 p-6 flex flex-col gap-5">
              <h2 className="font-semibold text-lg">Your NFTs</h2>

              {/* rank & sort controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between gap-3 bg-black/25 border border-white/10 rounded-xl px-3 py-2">
                  <span className="text-xs opacity-80">Max rank</span>
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={rankMax}
                    onChange={(e) => setRankMax(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-28 bg-transparent outline-none text-sm text-right"
                    disabled={!Object.keys(ranksById).length}
                  />
                </label>

                <label className="flex items-center justify-between gap-3 bg-black/25 border border-white/10 rounded-xl px-3 py-2">
                  <span className="text-xs opacity-80">Sort by</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="bg-transparent outline-none text-sm"
                    disabled={!Object.keys(ranksById).length}
                  >
                    <option value="id">Token ID</option>
                    <option value="rank">Rank (best → worst)</option>
                  </select>
                </label>
              </div>

              {/* tiny hint */}
              {!Object.keys(ranksById).length && (
                <div className="text-xs opacity-60">
                  Tip: drop <code>ranks.json</code> (or <code>ranks.csv</code>) in <code>/public</code> to enable rank filters.
                </div>
              )}


              {/* actions row (centered) */}
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={discoverOwned}
                  className="px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/20 text-sm"
                >
                  Load all your CRKL
                </button>
                <button
                  onClick={() => refreshPending()}
                  className="px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/20 text-sm"
                >
                  Refresh pending
                </button>
                <button
                  onClick={handleClaimAll}
                  disabled={claiming}
                  className="px-4 py-2 rounded-2xl bg-emerald-500/20 hover:bg-emerald-500/30 text-sm disabled:opacity-50"
                >
                  Claim all
                </button>
              </div>


              {/* centered total pending */}
              <div className="flex justify-center">
                <div className="rounded-xl px-3 py-1 bg-black/25 border border-white/10 text-sm">
                  Total pending:&nbsp;
                  <span className="font-mono">
                    {formatUnits(totalPending, rewardToken.decimals)} {rewardToken.symbol}
                  </span>
                </div>
              </div>

              {/* input */}
              <div>
                <label className="text-xs opacity-80">Or enter token IDs (comma/space separated)</label>
                <input
                  value={manualTokenIds}
                  onChange={(e) => setManualTokenIds(e.target.value)}
                  placeholder="1, 2, 3"
                  className="mt-2 w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 outline-none"
                />
              </div>
            </div>
          </div>


        </section>


        {status && (
          <div className={`${GLASS} ${SOFT_SHADOW} p-3 mt-4 text-sm`}>
            {status}
          </div>
        )}


        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Overview</h2>
          </div>

          {/* NEW: one glass container with a scrollable interior */}
          <div className={`${GLASS} ${SOFT_SHADOW} mt-4 p-3 md:p-4`}>
            <div className="max-h-[520px] overflow-y-auto pr-2 space-y-3">
              {ids.length === 0 && (
                <div className="p-4 text-sm opacity-70">No token IDs provided.</div>
              )}

              {ids.map((id) => {
                const info = pendingById[id] || {};
                const weight = info.weight || weights.tokens?.[String(id)]?.weight;
                const amount = info.amount ? formatUnits(info.amount, rewardToken.decimals) : "-";
                const isValid = info.valid ?? (weights.tokens?.[String(id)] ? "?" : false);
                const proofLen = weights.tokens?.[String(id)]?.proof?.length || 0;

                const rankRaw = ranksById?.[String(id)] ?? ranksById?.[id];
                const rankNum = Number(rankRaw);
                const hasRank = Number.isFinite(rankNum) && rankNum > 0;

                return (
                  <div key={id} className={`${GLASS_HOVER} p-3 md:p-4 border border-white/10 rounded-2xl`}>
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="w-12 h-12 md:w-14 md:h-14 rounded-xl overflow-hidden bg-white/10 border border-white/10 shrink-0">
                        <img
                          src={tokenImages[id] || PLACEHOLDER_SRC}
                          alt={`#${id}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <div className="font-mono text-base md:text-lg">#{id}</div>
                          {hasRank && <span className={BADGE}>Rank&nbsp;#{rankNum}</span>}
                          <div className="text-xs md:text-sm opacity-80">
                            <span className="opacity-70">Weight:</span>{" "}
                            <span className="font-mono">{weight ? weight.toString() : "-"}</span>
                            <span className="mx-2">•</span>
                            <span className="opacity-70">Proof:</span>{" "}
                            <span className="font-mono">{proofLen ? `${proofLen} nodes` : "-"}</span>
                          </div>
                        </div>

                        <div className="mt-1 text-xs md:text-sm opacity-80">
                          Pending:{" "}
                          <span className="font-mono">
                            {isValid === false ? "❌" : `${amount} ${rewardToken.symbol}`}
                          </span>
                        </div>
                      </div>

                      <div className="shrink-0">
                        <button onClick={() => handleClaimOne(id)} className={BTN_PRIMARY}>
                          Claim
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>



        <section className="mt-8">
          <div className={`${GLASS} ${SOFT_SHADOW} p-4 md:p-5`}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold text-lg">Claim History</h2>
              <div className="flex items-center gap-2">
                <button onClick={() => loadHistory({ blocksBack: blocksFromDays(7) })} className={BTN_GHOST}>
                  Load 7d
                </button>
                <button onClick={() => loadHistory({ blocksBack: blocksFromDays(30) })} className={BTN_GHOST}>
                  Load 30d
                </button>
                <button onClick={() => loadHistory()} className={BTN_GHOST}>
                  Load 500k blocks
                </button>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left opacity-70">
                  <tr>
                    <th className="px-3 py-2">Block</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Recipient</th>
                    <th className="px-3 py-2">TokenID</th>
                    <th className="px-3 py-2">Amount ({rewardToken.symbol})</th>
                  </tr>
                </thead>
                <tbody>
                  {history.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-4 opacity-60">No data loaded.</td></tr>
                  )}
                  {history.map((h, i) => (
                    <tr key={i} className="border-t border-white/10">
                      <td className="px-3 py-2 font-mono">{h.blockNumber}</td>
                      <td className="px-3 py-2">{h.type}</td>
                      <td className="px-3 py-2 font-mono">{short(h.to)}</td>
                      <td className="px-3 py-2">{h.tokenId}</td>
                      <td className="px-3 py-2">{formatUnits(h.amount, rewardToken.decimals)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Sticky dock */}
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
          <div className={`${GLASS} ${SOFT_SHADOW} px-3 py-2 rounded-2xl flex items-center gap-3`}>
            <div className="text-sm opacity-80">
              Pending: <span className="font-mono">{fmt(totalPendingHuman, 4)} {rewardToken.symbol}</span>
            </div>
            <button onClick={handleClaimAll} disabled={claiming} className={BTN_PRIMARY}>Claim all</button>
          </div>
        </div>

        {/* Technical Details Modal */}
          {showDetails && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/60" onClick={() => setShowDetails(false)} />
              <div className={`${GLASS} ${SOFT_SHADOW} relative w-[min(720px,95vw)] p-5`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold">Technical details</h3>
                  <button className={BTN_GHOST} onClick={() => setShowDetails(false)}>Close</button>
                </div>

                <div className="mt-2 text-sm opacity-80 space-y-2 font-mono leading-relaxed">
                  <div>Distributor: <code>{DISTRIBUTOR_ADDRESS}</code></div>
                  <div>NFT: <code>{NFT_ADDRESS}</code> ({nftMeta.name}{nftMeta.symbol && ` • ${nftMeta.symbol}`})</div>
                  <div>Reward token: <code>{rewardToken.address}</code> ({rewardToken.symbol}, {rewardToken.decimals} dp)</div>
                  <div>Weights JSON: <code>{WEIGHTS_JSON_URL}</code></div>
                  <div>Merkle root: <code className="break-all">{weights.root || "(not loaded)"}</code></div>
                  <div>Total weight: <code>{weights.totalWeight || "(not loaded)"}</code></div>
                </div>
              </div>
            </div>
          )}
                      

        <footer className="mt-10 text-center text-xs opacity-70">
          <p>
            Tip: host <code>weights.json</code> in <code>/public</code> en controleer dat <code>root</code> en <code>totalWeight</code> overeenkomen met on-chain.
            Zet <code>VITE_MORALIS_KEY</code> in <code>.env</code> voor snelle discovery (later, optioneel).
          </p>
        </footer>
      </div>
    </div>
  );
}
