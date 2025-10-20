// src/pages/EmpireArmory.jsx
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";

// ====== CONFIG ======
const WEAPON_NFT_ADDRESS = "0xB09b903403775Ac0e294B845bF157Bd6A5e8e329";
const EBISUS_LINK = `https://app.ebisusbay.com/collection/${WEAPON_NFT_ADDRESS}?chain=cronos`;
const MINT_URL = "https://mint.crooks.finance/";

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
    // invert so larger values are higher on chart
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
        {/* faint background line */}
        <path d={d} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={strokeWidth + 2} />
        {/* main line */}
        <path d={d} fill="none" stroke="white" strokeOpacity="0.9" strokeWidth={strokeWidth} />
        {/* last point */}
        <circle cx={px(last.t)} cy={py(last.total)} r="3.5" fill="white" />
      </svg>
    </div>
  );
}

export default function EmpireArmory() {
  const { provider, address } = useWallet();

  const [readProvider, setReadProvider] = useState(() => {
    // try local proxy /rpc first, else null (we’ll fall back to wallet)
    const url = `${window.location.origin}/rpc`;
    try {
      new URL(url);
      return new ethers.JsonRpcProvider(url);
    } catch {
      return null;
    }
  });

  // if wallet provider exists, use it as readProvider fallback
  useEffect(() => {
    if (!readProvider && provider) setReadProvider(provider);
  }, [provider, readProvider]);

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
    // append when totalStrength changes meaningfully
    if (!Number.isFinite(totalStrength)) return;
    setStrengthHistory((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.total === totalStrength) return prev; // no change
      const next = [...prev, { t: Date.now(), total: totalStrength }];
      // cap length
      if (next.length > 200) next.shift();
      saveStrengthHistory(next);
      return next;
    });
  }, [totalStrength]);

  // ---- Discover owned weapons ----
  useEffect(() => {
    (async () => {
      if (!nft || !address) return;
      setStatus("Loading your weapons…");

      try {
        // check ERC721Enumerable
        const ENUM_ID = "0x780e9d63";
        const enumerable = await nft.supportsInterface(ENUM_ID).catch(() => false);

        let ids = [];
        if (enumerable) {
          const bal = await nft.balanceOf(address);
          const n = Number(bal);
          for (let i = 0; i < n; i++) {
            const id = await nft.tokenOfOwnerByIndex(address, i);
            ids.push(Number(id));
          }
        } else {
          setStatus("Collection is not enumerable; owned sweep not implemented.");
          return;
        }

        ids.sort((a, b) => a - b);

        // Try to hydrate via tokenURI; fallback to local metadata folder /metadata_weapons/<id>.json
        const results = [];
        for (const id of ids) {
          let img = null;
          let strength = 0;

          // 1) tokenURI → fetch metadata
          let tokenUriJson = null;
          try {
            const uri = await nft.tokenURI(id);
            const url = resolveMediaUrl(uri);
            if (url) tokenUriJson = await fetchJson(url);
          } catch {
            // ignore
          }

          if (tokenUriJson) {
            img =
              resolveMediaUrl(
                tokenUriJson.image ||
                tokenUriJson.image_url ||
                tokenUriJson.animation_url
              ) || img;
            strength = parseStrength(tokenUriJson);
          }

          // 2) fallback: local metadata file
          if (strength === 0 || !img) {
            const localMeta = await fetchJson(`/metadata_weapons/${id}.json`);
            if (localMeta) {
              if (!img) {
                img =
                  resolveMediaUrl(
                    localMeta.image ||
                    localMeta.image_url ||
                    localMeta.animation_url
                  ) || img;
              }
              if (strength === 0) strength = parseStrength(localMeta);
            }
          }

          results.push({
            id,
            image: img || "/pictures/satoshi.png",
            strength,
          });

          // small delay to avoid hammering gateways
          await sleep(60);
        }

        setItems(results);
        setTotalStrength(results.reduce((s, r) => s + (r.strength || 0), 0));
        setStatus(results.length ? "" : "No weapons found for this wallet.");
      } catch (e) {
        console.warn(e);
        setStatus("Failed to load your weapons.");
      }
    })();
  }, [nft, address]);

  // ---- Live EbisuBay feed (SSE) ----
  const [feed, setFeed] = useState([]);
  useEffect(() => {
    const addr = WEAPON_NFT_ADDRESS.toLowerCase();
    const es = new EventSource(`http://localhost:5174/events?addr=${addr}`);

    const add = (item) =>
      setFeed((prev) => [item, ...prev].slice(0, 12));

    const normalize = (type, ev) => {
      const nft = ev?.nft || ev;
      const rawId = String(
        ev?.nftId ??
        ev?.tokenId ??
        ev?.edition ??
        nft?.nftId ??
        nft?.tokenId ??
        nft?.edition ??
        ""
      );
      const addrRaw = nft?.nftAddress || ev?.nftAddress || "";
      const ts = Number(ev?.saleTime || ev?.listingTime || ev?.time || 0);
      const permalink =
        nft?.market_uri ||
        (addrRaw && rawId
          ? `https://app.ebisusbay.com/collection/${addrRaw}/${rawId}`
          : "");
      return {
        type,
        nftId: rawId,
        name: nft?.name || (rawId ? `#${rawId}` : ""),
        image: nft?.image || nft?.original_image || "/pictures/satoshi.png",
        price: ev?.price ?? (ev?.priceWei ? Number(ethers.formatUnits(ev.priceWei, 18)).toFixed(2) : undefined),
        time: ts,
        uri: permalink,
      };
    };

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        add(normalize("Event", payload));
      } catch {}
    };
    es.onerror = (e) => console.warn("[armory ebisus] sse error", e);
    return () => es.close();
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
      {/* overlay for readability */}
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

        {/* Top row — left = EbisuBay feed, right = Strength timeline */}
        <section className="mt-6 grid md:grid-cols-2 gap-5">
          {/* EbisuBay feed (LEFT) */}
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
                    key={`${ev.type}-${ev.nftId}-${i}`}
                    href={ev.uri || EBISUS_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${GLASS} p-3 flex items-center gap-3 hover:bg-white/10 transition`}
                    title="View on Ebisu’s Bay"
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/10 border border-white/10 shrink-0">
                      <img
                        src={ev.image}
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

          {/* Strength timeline (RIGHT) */}
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

        {/* Weapons BELOW the two squares */}
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
      </div> {/* end inner container */}
    </div>   
  );
}
