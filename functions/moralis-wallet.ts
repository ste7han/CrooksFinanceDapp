export const onRequest: PagesFunction = async (context) => {
  const { request, env } = context;

  // ===== Debug: laat in de CF logs zien of de key binnenkomt =====
  console.log("MORALIS_KEY seen?", !!env.MORALIS_KEY);

  // Query params
  const url = new URL(request.url);
  const owner = url.searchParams.get("owner")?.trim() || "";
  const cursor = url.searchParams.get("cursor")?.trim() || "";

  if (!owner) {
    return new Response(JSON.stringify({ error: "Missing owner" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Body (optioneel) voor token_addresses
  let body: any = {};
  try { body = await request.json(); } catch {}

  const token_addresses = (body?.token_addresses ?? "").toString().trim();

  // Zorg dat de secret er is
  const apiKey = env.MORALIS_KEY;
  if (!apiKey) {
    // 401 hier = server heeft geen key → check env bindings
    return new Response(JSON.stringify({ error: "MORALIS_KEY missing on server" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  // Bouw Moralis URL
  const moralisBase = "https://deep-index.moralis.io/api/v2.2";
  const moralisUrl = new URL(`${moralisBase}/${owner}/nft`);
  moralisUrl.searchParams.set("chain", "cronos");
  moralisUrl.searchParams.set("format", "decimal");
  moralisUrl.searchParams.set("limit", "100");
  moralisUrl.searchParams.set("normalizeMetadata", "true");
  moralisUrl.searchParams.set("media_items", "true");
  if (token_addresses) moralisUrl.searchParams.set("token_addresses", token_addresses);
  if (cursor) moralisUrl.searchParams.set("cursor", cursor);

  // Proxy call -> Moralis
  const resp = await fetch(moralisUrl.toString(), {
    headers: {
      "X-API-Key": apiKey,
    },
  });

  // Als je ooit CU-limit raakt, geeft Moralis hier 429 terug (niet 401)
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return new Response(
      JSON.stringify({ error: "Moralis upstream error", status: resp.status, text }),
      { status: resp.status, headers: { "content-type": "application/json" } }
    );
  }

  const json = await resp.json();
  return new Response(JSON.stringify(json), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
};
