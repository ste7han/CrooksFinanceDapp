// functions/moralis-wallet.ts
// POST /moralis-wallet?owner=0x...&cursor=...
export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner");
  const cursor = url.searchParams.get("cursor") || "";
  if (!owner) return new Response('{"error":"owner required"}', { status: 400 });

  // Simple in-memory rate limit per worker instance (1 minute window)
  const ip = request.headers.get("cf-connecting-ip") || "0.0.0.0";
  // @ts-ignore
  globalThis.__hits ||= new Map<string, { count: number; ts: number }>();
  // @ts-ignore
  const rec = globalThis.__hits.get(ip) || { count: 0, ts: Date.now() };
  const now = Date.now();
  if (now - rec.ts > 60_000) { rec.count = 0; rec.ts = now; }
  rec.count += 1;
  // @ts-ignore
  globalThis.__hits.set(ip, rec);
  if (rec.count > 60) return new Response('{"error":"rate limit"}', { status: 429 });

  const apiKey = env.MORALIS_KEY as string;
  const target = new URL(`https://deep-index.moralis.io/api/v2.2/${owner}/nft`);
  target.searchParams.set("chain", "cronos");
  target.searchParams.set("format", "decimal");
  target.searchParams.set("limit", "100");
  target.searchParams.set("normalizeMetadata", "true");
  target.searchParams.set("media_items", "true");
  // NOTE: we pass the collection address from the client (safe)
  const body = await request.text();
  let token_addresses = "";
  try { token_addresses = JSON.parse(body)?.token_addresses || ""; } catch {}
  if (token_addresses) target.searchParams.set("token_addresses", token_addresses);
  if (cursor) target.searchParams.set("cursor", cursor);

  // Edge cache by URL (owner + cursor + collection)
  const cache = caches.default;
  const cacheKey = new Request(target.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) {
    return new Response(await cached.text(), {
      status: cached.status,
      headers: {
        "content-type": cached.headers.get("content-type") || "application/json",
        "access-control-allow-origin": "*",
      },
    });
  }

  const resp = await fetch(target.toString(), {
    headers: { "X-API-Key": apiKey },
  });
  const txt = await resp.text();

  const out = new Response(txt, {
    status: resp.status,
    headers: {
      "content-type": resp.headers.get("content-type") || "application/json",
      "access-control-allow-origin": "*",
      // cache successful pages for 2 minutes
      "cache-control": resp.ok ? "public, max-age=120" : "no-store",
    },
  });

  if (resp.ok) await cache.put(cacheKey, out.clone());
  return out;
};
