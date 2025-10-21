// functions/ebisus-feed.ts
// Cloudflare Pages Function – SSE feed for Ebisu events
// Required Env:
//   VITE_EBISUS_API = https://api.ebisusbay.com
//
// Query params:
//   addr  (required) -> collection address
//   types (optional) -> comma list, default "sold"
//   interval (opt)   -> seconds between polls (min 3, default 6)
//   limit (optional) -> how many to pull per poll (1-50; default 10)
//
// This streams text/event-stream so your frontend EventSource receives events.

type Env = {
  VITE_EBISUS_API: string;
};

const PATH_EVENTS = "/marketplace/events"; // <— adjust if needed

function sseEncode(obj: unknown) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

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
  const ts = Number(ev?.saleTime ?? ev?.listingTime ?? ev?.time ?? 0) || 0;

  const image =
    nft?.image ||
    nft?.original_image ||
    ev?.image ||
    null;

  const type = ev?.type || (ev?.eventType ? String(ev.eventType) : "Sold");
  const priceWei = ev?.priceWei ?? null;
  const price = ev?.price ?? null;

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
  const types = (url.searchParams.get("types") || "sold").toLowerCase(); // e.g. "listed,sold"
  const intervalSec = Math.max(3, Number(url.searchParams.get("interval") || 6));
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 10)));

  if (!addr) {
    return new Response("Missing addr\n", { status: 400 });
  }

  const base = (ctx.env?.VITE_EBISUS_API || "").replace(/\/+$/, "");
  if (!base) {
    return new Response("VITE_EBISUS_API not set\n", { status: 500 });
  }

  const encoder = new TextEncoder();
  let lastSeenKeys = new Set<string>();
  let lastMaxTs = 0;

  const stream = new ReadableStream({
    async start(controller) {
      // initial hello
      controller.enqueue(encoder.encode(`event: hello\n${sseEncode({ ok: true })}`));

      const poll = async () => {
        try {
          const api = new URL(PATH_EVENTS, base);
          api.searchParams.set("collection", addr);
          api.searchParams.set("types", types);
          api.searchParams.set("limit", String(limit));

          const res = await fetch(api.toString(), { cf: { cacheTtl: 10 } });
          if (!res.ok) throw new Error(`Upstream ${res.status}`);
          const json = await res.json();
          const rows: any[] = Array.isArray(json)
            ? json
            : Array.isArray(json?.data)
            ? json.data
            : [];

          const normalized = rows
            .map(normalize)
            .filter(Boolean)
            .sort((a, b) => (a.time || 0) - (b.time || 0)); // old->new for emitting

          for (const item of normalized) {
            const k = item.dedupeKey || `${item.type}|${item.nftAddress}|${item.nftId}|${item.time}`;
            if (lastSeenKeys.has(k)) continue;
            // optional: only emit strictly newer than lastMaxTs
            if (item.time && item.time < lastMaxTs) continue;

            lastSeenKeys.add(k);
            lastMaxTs = Math.max(lastMaxTs, Number(item.time || 0));

            // emit as event by type
            controller.enqueue(
              encoder.encode(`event: ${item.type?.toLowerCase() || "event"}\n${sseEncode(item)}`)
            );

            // avoid unbounded growth
            if (lastSeenKeys.size > 500) {
              // drop oldest half
              lastSeenKeys = new Set(Array.from(lastSeenKeys).slice(250));
            }
          }
        } catch (e) {
          controller.enqueue(encoder.encode(`event: error\n${sseEncode({ error: "poll_failed" })}`));
        }
      };

      // first poll quickly, then on interval
      await poll();
      const timer = setInterval(poll, intervalSec * 1000);

      // keep-alive ping (important for some proxies)
      const ka = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\n${sseEncode(Date.now())}`));
      }, 15000);

      (controller as any)._timer = timer;
      (controller as any)._ka = ka;
    },
    cancel() {
      const timer = (this as any)._timer;
      const ka = (this as any)._ka;
      if (timer) clearInterval(timer);
      if (ka) clearInterval(ka);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
};
