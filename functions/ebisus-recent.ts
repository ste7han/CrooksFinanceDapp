export const onRequestGet: PagesFunction<{
  VITE_EBISUS_API: string | undefined;
}> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();
  const limit = Math.max(1, Math.min(10, Number(url.searchParams.get("limit") || "4")));

  // CORS preflight (if someone calls cross-origin)
  if (ctx.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (!addr) {
    return json({ error: "missing_addr" }, 400);
  }

  // Guard: no env set? return empty list, don’t crash
  const base = ctx.env.VITE_EBISUS_API?.trim();
  if (!base) {
    console.warn("[ebisus-recent] VITE_EBISUS_API is not set – returning []");
    return json([], 200);
  }

  try {
    // 🔧 TODO: Replace this with the *actual* Ebisu endpoint you want to use.
    // The code below calls a placeholder path that many APIs use for recent sales.
    // Adjust the path/query to match Ebisu's real API.
    const upstream = new URL(base);
    // Example shape; update to correct one when you confirm docs:
    // /collection/<addr>/sales?limit=<n>
    upstream.pathname = `/collection/${addr}/sales`;
    upstream.searchParams.set("limit", String(limit));

    const r = await fetch(upstream.toString(), {
      headers: { "accept": "application/json" },
      cf: { cacheTtl: 15, cacheEverything: false }, // tiny edge cache
    });

    if (!r.ok) {
      console.error("[ebisus-recent] upstream not ok:", r.status, r.statusText);
      return json([], 200); // be forgiving
    }

    const data = await r.json().catch(() => null);
    if (!data) return json([], 200);

    // Optional: map to a minimal normalized shape your FE expects
    // but keep it raw for now.
    return json(data, 200);
  } catch (e) {
    console.error("[ebisus-recent] fetch failed:", e);
    return json([], 200); // never 500 to the browser
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
