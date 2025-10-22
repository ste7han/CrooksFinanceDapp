// src/pages/EmpireArmory.jsx
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { getEbisuSocket } from "../lib/ebisusSocket";

// ====== CONFIG ======
const WEAPON_NFT_ADDRESS = "0xB09b903403775Ac0e294B845bF157Bd6A5e8e329";
const EBISUS_LINK = `https://app.ebisusbay.com/collection/cronos/${WEAPON_NFT_ADDRESS}?chain=cronos`;
const MINT_URL = "https://mint.crooks.finance/";
const PLACEHOLDER_SRC = "/pictures/satoshi.png";

// Optional envs (same pattern as Legends)
const FEED_BASE = (import.meta.env.VITE_EBISUS_FEED_URL || "").trim();
const RECENT_BASE = (
  import.meta.env.VITE_EBISUS_RECENT_URL ||
  (FEED_BASE ? `${FEED_BASE.replace(/\/+$/,"")}/recent` : "")
).trim();

// Read RPC (env → same-origin /rpc)
const RPC_URL = (() => {
  const u = import.meta.env.VITE_RPC_URL?.trim();
  if (u && /^https?:\/\//i.test(u)) return u;
  return `${location.origin}/rpc`; // Cloudflare Worker/Pages Function route
})();

// ---- Moralis proxy (reuse the same backend you have for Legends) ----
const MORALIS_PROXY = "/moralis-wallet";

// Minimal ABIs
const erc721Abi = [
  "function balanceOf(address) view returns(uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns(uint256)",
  "function supportsInterface(bytes4) view returns(bool)",
  "function tokenURI(uint256) view returns(string)",
  "function name() view returns(string)",
  "function symbol() view returns(string)",
];

const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const GLASS_HOVER = "hover:bg-white/10 hover:border-white/20 transition";
const SOFT_SHADOW = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const BTN = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_PRIMARY = `${BTN} bg-emerald-500 text-black hover:bg-emerald-400`;
const BTN_GHOST = `${BTN} bg-white/8 hover:bg-white/14 border border-white/12`;
const BADGE = "inline-flex items-center gap-2 rounded-xl px-2 py-1 bg-white/8 border border-white/10 text-xs";

// ===== Helpers =====
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

// ---- Strength timeline persistence ----
const HISTORY_KEY = "crooks:armory:strengthHistory";
function loadStrengthHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveStrengthHistory(arr) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
  } catch {}
}

// ---- Sparkline generator (no libs) ----
function Sparkline({ data, width = 560, height = 90, strokeWidth = 2 }) {
  if (!data?.length) {
    return (
      <div className="h-[90px] flex items-center justify-center text-xs opacity-60">
        No data yet
      </div>
    );
  }
  const padding = 6;
  const w = Math.max(40, width);
  const h = Math.max(40, height);
  const xs = data.map((d) => d.t);
  const ys = data.map((d) => d.total);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const px = (x) =>
    padding + ((x - minX) / spanX) * (w - padding * 2);
  const py = (y) =>
    padding + (1 - (y - minY) / spanY) * (h - padding * 2);

  const d = data
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${px(pt.t).toFixed(2)} ${py(pt.total).toFixed(2)}`)
    .join(" ");

  const last = data[data.length - 1];
  const first = data[0];
  const delta = last.total - first.total;
  const deltaSign = delta === 0 ? "" : delta > 0 ? "+" : "−";

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-sm opacity-70">Total strength trend</div>
        <div className="text-sm">
          <span className="font-semibold">{last.total}</span>
          <span className={`ml-2 text-xs ${delta > 0 ? "text-emerald-300" : delta < 0 ? "text-red-300" : "opacity-70"}`}>
            {deltaSign}{Math.abs(delta)}
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full h-[90px]"
        role="img"
        aria-label="Strength sparkline"
      >
        <path d={d} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={strokeWidth + 2} />
        <path d={d} fill="none" stroke="white" strokeOpacity="0.9" strokeWidth={strokeWidth} />
        <circle cx={px(last.t)} cy={py(last.total)} r="3.5" fill="white" />
      </svg>
    </div>
  );
}

// ---- Ebisu normalizer (same idea as Legends) ----
function normalizeEbisuEvent(type, ev) {
  if (!ev) return null;

  const nft = ev.nft || {};
  const rawId = String(
    ev.nftId ?? ev.tokenId ?? nft.nftId ?? nft.tokenId ?? nft.edition ?? ""
  );

  const addrRaw = (
    ev.nftAddress ??
    nft.nftAddress ??
    ev.collectionAddress ??
    ""
  ).toLowerCase();

  const ts = Number(
    ev.saleTime ??
    ev.listingTime ??
    ev.time ??
    ev.event?.blockTimestamp ??
    ev.event?.time ??
    Date.now() / 1000
  );

  const price = (() => {
    const p = ev.price ?? null;
    if (p != null && !Number.isNaN(Number(p))) return Number(p).toFixed(2);
    if (ev.priceWei) {
      try { return Number(ethers.formatUnits(ev.priceWei, 18)).toFixed(2); }
      catch { /* ignore */ }
    }
    return "0.00";
  })();

  const CRO_ZERO = "0x0000000000000000000000000000000000000000";
  const MOON_ADDR = "0x46E2B5423F6ff46A8A35861EC9DAfF26af77AB9A".toLowerCase();
  const currencyAddr = (
    ev.currency ||
    ev.currencyAddress ||
    ev.currency_address ||
    nft.currency ||
    ev.paymentToken ||
    ev.payment_token ||
    ev.payment_token_address ||
    ev.event?.currency ||
    ev.event?.currencyAddress ||
    ""
  )?.toLowerCase?.() || "";
  let currency = "CRO";
  if (currencyAddr && currencyAddr !== CRO_ZERO) {
    currency = currencyAddr === MOON_ADDR ? "MOON" : "CRO";
  }

  const permalink =
    nft.market_uri ||
    `https://app.ebisusbay.com/collection/cronos/${addrRaw}/${rawId}`;

  const image =
    nft.image ||
    nft.original_image ||
    nft.image_url ||
    nft.media?.[0]?.gateway_media_url ||
    PLACEHOLDER_SRC;

  const dedupeKey = String(
    ev.listingId ??
    ev.txHash ??
    `evt|${addrRaw}|${rawId}|${ev.priceWei ?? ev.price ?? ""}|${ts}`
  );

  return {
    type,
    listingId: ev.listingId,
    nftId: rawId,
    nftAddress: addrRaw,
    name: nft.name || (rawId ? `#${rawId}` : ""),
    image,
    price,
    time: ts,
    uri: permalink,
    dedupeKey,
    currency,
  };
}

// ---- Moralis-backed ownership discovery (plus optional images) ----
async function moralisProxyPage(owner, { cursor = "", collection, limit = 100 } = {}) {
  if (!owner) return null;
  const u = new URL(MORALIS_PROXY, location.origin);
  u.searchParams.set("owner", owner);
  if (cursor) u.searchParams.set("cursor", cursor);

  const resp = await fetch(u.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token_addresses: collection || "", limit }),
  });

  if (resp.status === 429) {
    await new Promise((r) => setTimeout(r, 800));
    return moralisProxyPage(owner, { cursor, collection, limit });
  }
  if (!resp.ok) return null;
  return resp.json();
}

async function discoverWeaponsViaMoralis(owner) {
  const ids = [];
  const images = {};
  let cursor = "";

  while (true) {
    const data = await moralisProxyPage(owner, {
      cursor,
      collection: WEAPON_NFT_ADDRESS,
      limit: 100,
    });
    if (!data || !Array.isArray(data.result) || data.result.length === 0) break;

    for (const r of data.result) {
      const n = Number(r.token_id ?? r.tokenId);
      if (!Number.isFinite(n)) continue;

      let image =
        r.normalized_metadata?.image ||
        (Array.isArray(r.media) &&
          r.media[0] &&
          (r.media[0].gateway_media_url || r.media[0].original_media_url)) ||
        (() => {
          try {
            return (r.metadata && JSON.parse(r.metadata))?.image || null;
          } catch {
            return null;
          }
        })();

      if (image) images[n] = resolveMediaUrl(image);
      ids.push(n);
    }

    cursor = data.cursor || "";
    if (!cursor) break;
    await sleep(120);
  }

  const uniq = Array.from(new Set(ids)).sort((a, b) => a - b);
  return { ids: uniq, images };
}

export default function EmpireArmory() {
  const { provider, address } = useWallet();

  // Prefer connected wallet provider; else env-/proxy-backed read provider
  const [readProvider, setReadProvider] = useState(null);
  useEffect(() => {
    if (provider) {
      setReadProvider(provider);
      return;
    }
    try {
      setReadProvider(new ethers.JsonRpcProvider(RPC_URL, { chainId: 25, name: "cronos" }));
    } catch {
      setReadProvider(null);
    }
  }, [provider]);

  const nft = useMemo(() => {
    if (!readProvider) return null;
    return new ethers.Contract(WEAPON_NFT_ADDRESS, erc721Abi, readProvider);
  }, [readProvider]);

  const [items, setItems] = useState([]); // [{id, image, strength}]
  const [totalStrength, setTotalStrength] = useState(0);
  const [status, setStatus] = useState("");

  // --- sorting: strength high->low or low->high
  const [sortStrengthDir, setSortStrengthDir] = useState("desc"); // 'desc' | 'asc'
  const sortedItems = useMemo(() => {
    const copy = [...items];
    copy.sort((a, b) =>
      sortStrengthDir === "desc" ? b.strength - a.strength : a.strength - b.strength
    );
    return copy;
  }, [items, sortStrengthDir]);

  // --- strength history ---
  const [strengthHistory, setStrengthHistory] = useState(() => loadStrengthHistory());
  useEffect(() => {
    if (!Number.isFinite(totalStrength)) return;
    setStrengthHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.total === totalStrength) return prev;
      const next = [...prev, { t: Date.now(), total: totalStrength }];
      if (next.length > 200) next.shift();
      saveStrengthHistory(next);
      return next;
    });
  }, [totalStrength]);

  // ---- Discover owned weapons (Moralis → Enumerable) ----
  useEffect(() => {
    (async () => {
      if (!address || !readProvider) return;
      setStatus("Loading your weapons…");

      try {
        // 1) Moralis wallet ownership (fast + no Enumerable dependency)
        let ids = [];
        let imageMap = {};
        try {
          const viaMoralis = await discoverWeaponsViaMoralis(address);
          if (viaMoralis && viaMoralis.ids.length) {
            ids = viaMoralis.ids;
            imageMap = viaMoralis.images || {};
          }
        } catch (e) {
          console.debug("[armory] Moralis discovery failed; will try Enumerable.", e);
        }

        // 2) If Moralis returned nothing, try ERC721Enumerable sweep
        if (!ids.length) {
          const ENUM_ID = "0x780e9d63";
          const enumerable = await nft.supportsInterface(ENUM_ID).catch(() => false);

          if (!enumerable) {
            setStatus("Collection is not enumerable and no indexer result—cannot sweep owned tokens.");
            setItems([]); setTotalStrength(0);
            return;
          }

          const bal = await nft.balanceOf(address);
          const n = Number(bal);
          for (let i = 0; i < n; i++) {
            const id = await nft.tokenOfOwnerByIndex(address, i);
            ids.push(Number(id));
          }
          ids.sort((a, b) => a - b);
        }

        // 3) Hydrate metadata/strength/images
        const results = [];
        for (const id of ids) {
          let img = imageMap[id] || null;
          let strength = 0;

          // tokenURI → fetch metadata
          try {
            const uri = await nft.tokenURI(id);
            const url = resolveMediaUrl(uri);
            const meta = url ? await fetchJson(url) : null;
            if (meta) {
              img ||= resolveMediaUrl(
                meta.image || meta.image_url || meta.animation_url
              );
              strength = parseStrength(meta) || strength;
            }
          } catch {}

          // fallback: local metadata
          if (!img || strength === 0) {
            const localMeta = await fetchJson(`/metadata_weapons/${id}.json`);
            if (localMeta) {
              img ||= resolveMediaUrl(
                localMeta.image || localMeta.image_url || localMeta.animation_url
              );
              strength ||= parseStrength(localMeta);
            }
          }

          results.push({
            id,
            image: img || PLACEHOLDER_SRC,
            strength,
          });

          await sleep(50);
        }

        setItems(results);
        setTotalStrength(results.reduce((s, r) => s + (r.strength || 0), 0));
        setStatus(results.length ? "" : "No weapons found for this wallet.");
      } catch (e) {
        console.warn(e);
        setStatus("Failed to load your weapons.");
      }
    })();
  }, [nft, address, readProvider]);

  // ---- Live EbisuBay feed (Socket + fallback) ----
  const [feed, setFeed] = useState([]);
  useEffect(() => {
    const addr = WEAPON_NFT_ADDRESS.toLowerCase();
    const socket = getEbisuSocket();

    const pushOne = (item) => {
      setFeed((prev) => {
        const merged = [item, ...prev];
        const seen = new Set();
        const uniq = [];
        for (const it of merged) {
          const key =
            it.listingId ||
            it.dedupeKey ||
            it.txHash ||
            `${it.type}:${it.nftId}:${it.price}:${it.time}`;
          if (seen.has(key)) continue;
          seen.add(key);
          uniq.push(it);
          if (uniq.length >= 12) break;
        }
        uniq.sort((a, b) => (b.time || 0) - (a.time || 0));
        return uniq;
      });
    };

    const handleEvent = (type) => (msg) => {
      let data = msg?.event ? msg.event : msg;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return; }
      }
      const nftAddr =
        data?.nft?.nftAddress?.toLowerCase?.() ||
        data?.nftAddress?.toLowerCase?.() ||
        data?.collectionAddress?.toLowerCase?.() ||
        "";
      if (!nftAddr || nftAddr !== addr) return;

      const n = normalizeEbisuEvent(type, data);
      if (n) pushOne(n);
    };

    [
      "Listed","listed","Sold","sold",
      "OfferMade","offerMade","CollectionOfferMade","collectionOfferMade",
    ].forEach((ev) => socket.on(ev, handleEvent(ev)));

    socket.on("connect", () => console.debug("[armory] ebisu connected"));
    socket.on("disconnect", () => console.debug("[armory] ebisu disconnected"));

    // Prefill from /recent then Moralis proxy (?address=)
    (async () => {
      let list = [];

      try {
        if (RECENT_BASE) {
          const res = await fetch(RECENT_BASE, { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) list = data;
          }
        }
      } catch {}

      if (!list.length) {
        try {
          const u = new URL("/api/recent-sales", location.origin);
          u.searchParams.set("address", WEAPON_NFT_ADDRESS);
          const res = await fetch(u.toString(), { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.result)) {
              list = data.result.map((ev) => ({
                type: "Sold",
                price: "0.00", // transfers don’t include sale price
                nftId: ev.token_id,
                nftAddress: ev.token_address,
                saleTime: Math.floor(new Date(ev.block_timestamp).getTime() / 1000),
                listingId: ev.transaction_hash,
                currency: "CRO",
                nft: { image: PLACEHOLDER_SRC, name: `#${ev.token_id}` },
              }));
            }
          }
        } catch (e) {
          console.warn("[armory] Moralis fallback failed:", e);
        }
      }

      if (list.length) {
        const normalized = list.map((ev) => normalizeEbisuEvent(ev.type || "Sold", ev)).filter(Boolean);
        setFeed((prev) => {
          const merged = [...normalized, ...prev];
          const seen = new Set();
          const uniq = [];
          for (const it of merged) {
            const key =
              it.listingId ||
              it.dedupeKey ||
              it.txHash ||
              `${it.type}:${it.nftId}:${it.price}:${it.time}`;
            if (seen.has(key)) continue;
            seen.add(key);
            uniq.push(it);
            if (uniq.length >= 12) break;
          }
          uniq.sort((a, b) => (b.time || 0) - (a.time || 0));
          return uniq;
        });
      }
    })();

    return () => {
      ["Listed","listed","Sold","sold","OfferMade","offerMade","CollectionOfferMade","collectionOfferMade"]
        .forEach((ev) => socket.off(ev));
    };
  }, []);

  return (
    <div
      className="min-h-screen w-full text-white relative bg-animated"
      style={{
        backgroundImage: "url('/pictures/Armory_banner.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.45),rgba(0,0,0,0.8))]" />
      <div className="relative max-w-6xl mx-auto p-6">
        {/* Header strip */}
        <div className={`${GLASS} ${SOFT_SHADOW} ${GLASS_HOVER} p-4 md:p-5 flex items-center justify-between gap-4`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Armory</h1>
            <p className="opacity-80">View your Crooks Empire Weapons and total strength.</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={MINT_URL} target="_blank" rel="noopener noreferrer" className={BTN_PRIMARY}>
              Mint more weapons
            </a>
            <a href={EBISUS_LINK} target="_blank" rel="noopener noreferrer" className={BTN_GHOST}>
              View on Ebisu’s Bay
            </a>
          </div>
        </div>

        {/* Totals */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`${GLASS} ${SOFT_SHADOW} p-4`}>
            <div className="text-xs opacity-70">Wallet</div>
            <div className="mt-1 text-2xl font-bold font-mono">
              {address ? address.slice(0, 6) + "…" + address.slice(-4) : "Not connected"}
            </div>
          </div>
          <div className={`${GLASS} ${SOFT_SHADOW} p-4`}>
            <div className="text-xs opacity-70">Weapons</div>
            <div className="mt-1 text-2xl font-bold">{items.length}</div>
          </div>
          <div className={`${GLASS} ${SOFT_SHADOW} p-4`}>
            <div className="text-xs opacity-70">Total Strength</div>
            <div className="mt-1 text-2xl font-bold">{totalStrength}</div>
          </div>
        </div>

        {status && (
          <div className={`${GLASS} ${SOFT_SHADOW} p-3 mt-4 text-sm`}>{status}</div>
        )}

        {/* Top row — left = Ebisu feed, right = Strength timeline */}
        <section className="mt-6 grid md:grid-cols-2 gap-5">
          {/* Ebisu feed */}
          <div className={`${GLASS} ${SOFT_SHADOW} p-5`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Market (Recent Sales/Listings)</h2>
              <a href={EBISUS_LINK} target="_blank" rel="noopener noreferrer" className={BTN_PRIMARY}>
                Open on Ebisu’s Bay
              </a>
            </div>

            <div className="mt-4">
              <div className="text-xs opacity-70 mb-2">
                {feed.length ? "Live market activity" : "Waiting for live events…"}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {feed.map((ev, i) => (
                  <a
                    key={ev.listingId ?? `${ev.type}-${ev.nftId}-${i}`}
                    href={ev.uri || EBISUS_LINK}
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
                      <div className="opacity-70">
                        {ev.price ? `${ev.price} ${ev.currency || "CRO"}` : ""}
                      </div>
                    </div>
                  </a>
                ))}
              </div>

              {!feed.length && (
                <div className="mt-3 text-xs opacity-60">
                  Tip: activity appears when a <b>Listed</b> or <b>Sold</b> event fires for this collection.
                </div>
              )}
            </div>
          </div>

          {/* Strength timeline */}
          <div className={`${GLASS} ${SOFT_SHADOW} p-5 flex flex-col`}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-lg">Strength timeline</h2>
              <div className="flex items-center gap-2">
                <button
                  className={BTN_GHOST}
                  onClick={() => {
                    const fresh = [{ t: Date.now(), total: totalStrength }];
                    setStrengthHistory(fresh);
                    saveStrengthHistory(fresh);
                  }}
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="mt-4">
              <Sparkline data={strengthHistory} />
            </div>

            <div className="mt-4 text-xs opacity-70">
              The sparkline updates whenever your total strength changes (persisted locally).
            </div>
          </div>
        </section>

        {/* Weapons */}
        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Your Weapons</h2>
            <button
              onClick={() => setSortStrengthDir((d) => (d === "desc" ? "asc" : "desc"))}
              className={BTN_GHOST}
              title="Sort by strength"
            >
              Strength: {sortStrengthDir === "desc" ? "High → Low" : "Low → High"}
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedItems.length === 0 && (
              <div className="text-sm opacity-70">No weapons to show.</div>
            )}
            {sortedItems.map((w) => (
              <div key={w.id} className={`${GLASS} ${GLASS_HOVER} p-3 flex items-center gap-3`}>
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-white/10 border border-white/10 shrink-0">
                  <img
                    src={w.image}
                    alt={`Weapon #${w.id}`}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="min-w-0">
                  <div className="font-mono">#{w.id}</div>
                  <div className="mt-1">
                    <span className={BADGE}>Strength: {w.strength}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
