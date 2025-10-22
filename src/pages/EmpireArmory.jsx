// src/pages/EmpireArmory.jsx
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useWallet } from "../context/WalletContext";
import { getEbisuSocket } from "../lib/ebisusSocket"; // ⬅️ add this

// ====== CONFIG ======
const WEAPON_NFT_ADDRESS = "0xB09b903403775Ac0e294B845bF157Bd6A5e8e329";
const EBISUS_LINK = `https://app.ebisusbay.com/collection/cronos/${WEAPON_NFT_ADDRESS}?chain=cronos`;
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
const IPFS_GATEWAYS = [
  "https://ipfs.ebisusbay.com/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://cloudflare-ipfs.com/ipfs/",
  "https://dweb.link/ipfs/",
  "https://nftstorage.link/ipfs/",
];
const ipfsToHttp = (u, gatewayBase = IPFS_GATEWAYS[0]) => {
  if (!u || !u.startsWith("ipfs://")) return u;
  const stripped = u.replace("ipfs://ipfs/", "").replace("ipfs://", "");
  return `${gatewayBase}${stripped}`;
};
const resolveMediaUrl = (u) => {
  if (!u) return null;
  if (u.startsWith("ipfs://")) return ipfsToHttp(u);
  if (u.startsWith("ar://")) return `https://arweave.net/${u.slice(5)}`;
  return u;
};
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
const loadStrengthHistory = () => {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") || []; } catch { return []; }
};
const saveStrengthHistory = (arr) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch {} };

// ---- Small pooler (avoid hammering gateways) ----
async function pPool(items, limit, worker) {
  const out = [];
  let i = 0, active = 0, done = 0;
  return new Promise((resolve) => {
    const next = () => {
      if (done === items.length) return resolve(out);
      while (active < limit && i < items.length) {
        const idx = i++, it = items[idx];
        active++;
        Promise.resolve(worker(it, idx))
          .then((r) => (out[idx] = r))
          .catch(() => (out[idx] = null))
          .finally(() => { active--; done++; next(); });
      }
    };
    next();
  });
}

// ---- Moralis wallet proxy (yours at /moralis-wallet) ----
async function moralisWallet(owner, { cursor = "", collection = "", limit = 100 } = {}) {
  const u = new URL("/moralis-wallet", location.origin);
  u.searchParams.set("owner", owner);
  if (cursor) u.searchParams.set("cursor", cursor);
  const body = { token_addresses: collection || "", limit };
  const resp = await fetch(u.toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return null;
  return await resp.json();
}

// ===== Component =====
export default function EmpireArmory() {
  const { provider, address } = useWallet();

  // Use env RPC if available; else fall back to wallet provider
  const [readProvider, setReadProvider] = useState(() => {
    const u = import.meta.env.VITE_RPC_URL?.trim();
    return u ? new ethers.JsonRpcProvider(u, { chainId: 25, name: "cronos" }) : null;
  });
  useEffect(() => { if (!readProvider && provider) setReadProvider(provider); }, [provider, readProvider]);

  const nft = useMemo(() => {
    if (!readProvider) return null;
    return new ethers.Contract(WEAPON_NFT_ADDRESS, erc721Abi, readProvider);
  }, [readProvider]);

  const [items, setItems] = useState([]); // [{id, image, strength}]
  const [totalStrength, setTotalStrength] = useState(0);
  const [status, setStatus] = useState("");

  // --- sorting: strength high->low or low->high
  const [sortStrengthDir, setSortStrengthDir] = useState("desc");
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

  // ---- Discover owned weapons (Moralis first, then Enumerable) ----
  useEffect(() => {
    (async () => {
      if (!address) return;
      if (!nft && !readProvider) return;

      setStatus("Loading your weapons…");
      let ids = [];

      // 1) Moralis fast path
      try {
        let cursor = "";
        const found = new Set();
        while (true) {
          const page = await moralisWallet(address, {
            cursor,
            collection: WEAPON_NFT_ADDRESS,
            limit: 100,
          });
          if (!page || !Array.isArray(page.result) || page.result.length === 0) break;
          for (const r of page.result) {
            const n = Number(r.token_id ?? r.tokenId);
            if (Number.isFinite(n)) found.add(n);
          }
          cursor = page.cursor || "";
          if (!cursor) break;
          await sleep(120);
        }
        ids = Array.from(found).sort((a, b) => a - b);
      } catch {
        // ignore, fallback below
      }

      // 2) ERC721Enumerable fallback
      if (!ids.length && nft) {
        try {
          const ENUM_ID = "0x780e9d63";
          const enumerable = await nft.supportsInterface(ENUM_ID).catch(() => false);
          if (enumerable) {
            const bal = await nft.balanceOf(address);
            const n = Number(bal);
            for (let i = 0; i < n; i++) {
              const id = await nft.tokenOfOwnerByIndex(address, i);
              ids.push(Number(id));
            }
            ids.sort((a, b) => a - b);
          }
        } catch {}
      }

      if (!ids.length) {
        setItems([]);
        setTotalStrength(0);
        setStatus("No weapons found for this wallet.");
        return;
      }

      // hydrate images + strength (tokenURI, then fallback local)
      const results = [];
      await pPool(ids, 4, async (id) => {
        let img = null;
        let strength = 0;

        // tokenURI
        try {
          if (nft?.tokenURI) {
            const uri = await nft.tokenURI(id);
            const url = resolveMediaUrl(uri);
            const meta = url ? await fetchJson(url) : null;
            if (meta) {
              img =
                resolveMediaUrl(
                  meta.image || meta.image_url || meta.animation_url
                ) || img;
              strength = parseStrength(meta) || strength;
            }
          }
        } catch {}

        // local fallback
        if ((strength === 0 || !img)) {
          const localMeta = await fetchJson(`/metadata_weapons/${id}.json`);
          if (localMeta) {
            if (!img) {
              img = resolveMediaUrl(localMeta.image || localMeta.image_url || localMeta.animation_url) || img;
            }
            if (strength === 0) strength = parseStrength(localMeta);
          }
        }

        results.push({ id, image: img, strength });
        await sleep(40);
      });

      // ensure no placeholders; if an image is still missing, we *leave it null*
      // (UI shows the card but with image element; Ebisu feed will still have images)
      const final = results.map(r => ({
        id: r.id,
        image: r.image || "", // no placeholder
        strength: r.strength || 0,
      }));

      setItems(final);
      setTotalStrength(final.reduce((s, r) => s + (r.strength || 0), 0));
      setStatus("");
    })();
  }, [nft, readProvider, address]);

  // ---- Live Ebisu feed (socket + recent prefill) ----
  const [feed, setFeed] = useState([]);
  useEffect(() => {
    const addr = WEAPON_NFT_ADDRESS.toLowerCase();
    const socket = getEbisuSocket();

    const updateFeed = (incoming) => {
      setFeed((prev) => {
        const merged = [incoming, ...prev];
        const seen = new Set();
        const uniq = [];
        for (const it of merged) {
          const key = it.dedupeKey || it.listingId || `${it.type}:${it.nftId}:${it.price}:${it.time || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          uniq.push(it);
          if (uniq.length >= 12) break;
        }
        return uniq.sort((a, b) => (b.time || 0) - (a.time || 0));
      });
    };

    const fetchTokenImage = async (tokenId) => {
      try {
        if (!nft?.tokenURI) return null;
        const uri = await nft.tokenURI(Number(tokenId));
        const url = resolveMediaUrl(uri);
        const meta = url ? await fetchJson(url) : null;
        return meta ? (resolveMediaUrl(meta.image || meta.image_url || meta.animation_url) || null) : null;
      } catch { return null; }
    };

    const normalize = async (type, ev) => {
      const nftObj = ev?.nft || ev;
      const rawId = String(
        ev?.nftId ?? ev?.tokenId ?? ev?.edition ?? nftObj?.nftId ?? nftObj?.tokenId ?? nftObj?.edition ?? ""
      );
      const addrRaw = (nftObj?.nftAddress || ev?.nftAddress || ev?.collectionAddress || "").toLowerCase();
      if (!addrRaw || addrRaw !== addr) return null;

      const ts = Number(
        ev?.saleTime ?? ev?.listingTime ?? ev?.time ?? ev?.event?.blockTimestamp ?? Date.now() / 1000
      );
      const permalink =
        nftObj?.market_uri ||
        `https://app.ebisusbay.com/collection/cronos/${addrRaw}/${rawId}`;

      // prefer event image, else fetch tokenURI to avoid placeholder
      let image =
        nftObj?.image ||
        nftObj?.original_image ||
        (Array.isArray(nftObj?.media) && (nftObj.media[0]?.gateway_media_url || nftObj.media[0]?.original_media_url)) ||
        null;
      if (!image && rawId) image = await fetchTokenImage(rawId);

      const price =
        typeof ev?.price === "number"
          ? ev.price.toFixed(2)
          : ev?.priceWei
          ? Number(ethers.formatUnits(ev.priceWei, 18)).toFixed(2)
          : "";

      return {
        type,
        nftId: rawId,
        name: nftObj?.name || (rawId ? `#${rawId}` : ""),
        image: image || "", // no placeholder
        price,
        time: ts,
        uri: permalink,
        dedupeKey: String(ev?.listingId || ev?.txHash || `evt|${addrRaw}|${rawId}|${price}|${ts}`),
        listingId: ev?.listingId || ev?.txHash || undefined,
      };
    };

    const onAny = (type) => async (msg) => {
      let data = msg?.event ? msg.event : msg;
      if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return; }
      }
      const n = await normalize(type, data);
      if (n) updateFeed(n);
    };

    [
      "Listed","listed","Sold","sold","OfferMade","offerMade","CollectionOfferMade","collectionOfferMade",
    ].forEach((ev) => socket.on(ev, onAny(ev)));

    // Prefill: last 8 transfers for this collection via your Moralis proxy
    (async () => {
      try {
        const res = await fetch(`/api/recent-sales?address=${WEAPON_NFT_ADDRESS}&limit=8`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const arr = Array.isArray(data?.result) ? data.result : [];
        // Map to “Sold” style items, enrich with tokenURI image if missing
        const mapped = await pPool(arr.slice(0, 8), 3, async (ev) => {
          const tokenId = ev.token_id;
          let image = ev.token_image ? resolveMediaUrl(ev.token_image) : null;
          if (!image && tokenId) {
            image = await (async () => {
              try {
                if (!nft?.tokenURI) return null;
                const uri = await nft.tokenURI(Number(tokenId));
                const url = resolveMediaUrl(uri);
                const meta = url ? await fetchJson(url) : null;
                return meta ? (resolveMediaUrl(meta.image || meta.image_url || meta.animation_url) || null) : null;
              } catch { return null; }
            })();
          }
          return {
            type: "Sold",
            nftId: String(tokenId),
            name: ev.token_name || `#${tokenId}`,
            image: image || "", // no placeholder
            price: ev.price
              ? ethers.formatUnits(ev.price, 18)
              : ev.value
              ? ethers.formatUnits(ev.value, 18)
              : ev.amount
              ? ethers.formatUnits(ev.amount, 18)
              : "",
            time: Math.floor(new Date(ev.block_timestamp).getTime() / 1000),
            uri: `https://app.ebisusbay.com/collection/cronos/${WEAPON_NFT_ADDRESS}/${tokenId}`,
            dedupeKey: String(ev.transaction_hash || `mrl|${tokenId}|${ev.price || ev.value || ev.amount}`),
            listingId: ev.transaction_hash,
          };
        });
        setFeed((prev) => {
          const merged = [...mapped.filter(Boolean), ...prev];
          const seen = new Set();
          const uniq = [];
          for (const it of merged) {
            const key = it.dedupeKey || it.listingId || `${it.type}:${it.nftId}:${it.price}:${it.time || ""}`;
            if (seen.has(key)) continue;
            seen.add(key);
            uniq.push(it);
            if (uniq.length >= 12) break;
          }
          return uniq.sort((a, b) => (b.time || 0) - (a.time || 0));
        });
      } catch {}
    })();

    return () => {
      ["Listed","listed","Sold","sold","OfferMade","offerMade","CollectionOfferMade","collectionOfferMade"]
        .forEach((ev) => socket.off(ev));
    };
  }, [nft]);

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
      {/* overlay */}
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.45),rgba(0,0,0,0.8))]" />
      <div className="relative max-w-6xl mx-auto p-6">
        <div className={`${GLASS} ${SOFT_SHADOW} ${GLASS_HOVER} p-4 md:p-5 flex items-center justify-between gap-4`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Armory</h1>
            <p className="opacity-80">View your Crooks Empire Weapons and total strength.</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={MINT_URL} target="_blank" rel="noopener noreferrer" className={BTN_PRIMARY}>Mint more weapons</a>
            <a href={EBISUS_LINK} target="_blank" rel="noopener noreferrer" className={BTN_GHOST}>View on Ebisu’s Bay</a>
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

        {status && <div className={`${GLASS} ${SOFT_SHADOW} p-3 mt-4 text-sm`}>{status}</div>}

        {/* Market + Strength */}
        <section className="mt-6 grid md:grid-cols-2 gap-5">
          {/* Market feed */}
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
                    key={`${ev.dedupeKey || ev.listingId || `${ev.type}-${ev.nftId}-${i}`}`}
                    href={ev.uri || EBISUS_LINK}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${GLASS} p-3 flex items-center gap-3 hover:bg-white/10 transition`}
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-white/10 border border-white/10 shrink-0">
                      {ev.image ? (
                        <img src={ev.image} alt={ev.name || (ev.nftId ? `#${ev.nftId}` : "NFT")} className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] opacity-60">no image</div>
                      )}
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

          {/* Strength timeline (unchanged) ... keep your Sparkline block */}
          {/* ... */}
        </section>

        {/* Weapons grid (unchanged except image placeholder removed) */}
        {/* ... keep your grid, but render empty string images as a subtle "no image" div if needed */}
      </div>
    </div>
  );
}
