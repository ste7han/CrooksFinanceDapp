// functions/ebisus-recent.ts
// Cloudflare Pages Function – returns most recent Ebisu events for a collection
// Required Page Env (Dashboard → Pages → Settings → Environment variables):
//   VITE_EBISUS_API = https://api.ebisusbay.com   (or your proxy)
//
// Query params:
//   addr  (required)  -> collection address (lower/upper case ok)
//   limit (optional)  -> default 4
//
// NOTE: Adjust PATHS below if your Ebisu API differs.

type Env = {
  VITE_EBISUS_API: string;
};

const PATH_RECENT = "/marketplace/events"; // <— adjust if needed
const DEFAULT_LIMIT = 4;

function normalize(ev: any) {
  if (!ev) return null;

  const nft = ev?.nft || ev;
  const rawId =
    String(
      ev?.nftId ??
        ev?.tokenId ??
        ev?.edition ??
        nft?.nftId ??
        nft?.tokenId ??
        nft?.edition ??
        ""
    ) || "";

  const addrRaw = (nft?.nftAddress || ev?.nftAddress || "").toLowerCase();

  // try multiple timestamp fields; cast to number (seconds)
  const ts =
    Number(ev?.saleTime ?? ev?.listingTime ?? ev?.time ?? 0) || 0;

  const priceWei = ev?.priceWei ?? null;
  const price = ev?.price ?? null;

  const image =
    nft?.image ||
    nft?.original_image ||
    ev?.image ||
    null;

  const type =
    ev?.type ||
    (ev?.eventType ? String(ev.eventType) : "Sold");

  const permalink =
    nft?.market_uri ||
    (addrRaw && rawId
      ? `https://app.ebisusbay.com/collection/${addrRaw}/${rawId}`
      : "");

  const dedupeKey =
    String(
      ev?.listingId ??
        ev?.txHash ??
        `${type}|${addrRaw}|${rawId}|${priceWei ?? price ?? ""}|${ts}`
    );

  return {
    type,
    listingId: ev?.listingId,
    txHash: ev?.txHash,
    nftId: rawId,
    nftAddress: addrRaw,
    name: nft?.name || (rawId ? `#${rawId}` : ""),
    image,
    priceWei,
    price,
    time: ts,
    uri: permalink,
    dedupeKey,
  };
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const addr = (url.searchParams.get("addr") || "").trim().toLowerCase();
  const limit = Math.min(
    20,
    Math.max(1, Number(url.searchParams.get("limit") || DEFAULT_LIMIT))
  );

  if (!addr) {
    return new Response(JSON.stringify({ error: "Missing addr" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const base = (ctx.env?.VITE_EBISUS_API || "").replace(/\/+$/, "");
  if (!base) {
    return new Response(JSON.stringify({ error: "VITE_EBISUS_API not set" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // 🔧 If Ebisu’s API path differs, change this URL construction:
  const api = new URL(PATH_RECENT, base);
  api.searchParams.set("collection", addr);
  api.searchParams.set("types", "sold"); // you can add "listed,sold" if you want both
  api.searchParams.set("limit", String(limit));

  try {
    const res = await fetch(api.toString(), { cf: { cacheTtl: 20 } });
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    const json = await res.json();

    // Expect either an array or an object with a 'data' array.
    const rows: any[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
      ? json.data
      : [];

    const normalized = rows
      .map(normalize)
      .filter(Boolean)
      .sort((a, b) => (b.time || 0) - (a.time || 0))
      .slice(0, limit);

    return new Response(JSON.stringify(normalized), {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "fetch failed" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};
