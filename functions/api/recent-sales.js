export async function onRequestGet(context) {
  try {
    // NFT contract (Crooks Legends)
    const nftAddress = "0x44102b7ab3e2b8edf77d188cd2b173ecbda60967";

    // Read your Cloudflare secret
    const moralisKey = context.env.MORALIS_KEY;
    if (!moralisKey) {
      return new Response(
        JSON.stringify({ error: "Missing MORALIS_KEY in environment" }),
        { status: 500 }
      );
    }

    // Optional: allow a limit query param like ?limit=20
    const urlObj = new URL(context.request.url);
    const limit = Number(urlObj.searchParams.get("limit")) || 10;

    // Build Moralis URL
    const url = `https://deep-index.moralis.io/api/v2/nft/${nftAddress}/trade?chain=cronos&limit=${limit}`;

    // Fetch from Moralis
    const res = await fetch(url, {
      headers: { "X-API-Key": moralisKey },
    });

    if (!res.ok) {
      const text = await res.text();
      return new Response(
        JSON.stringify({
          error: "Moralis request failed",
          status: res.status,
          body: text,
        }),
        { status: res.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const data = await res.json();

    // Return JSON to frontend
    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*", // optional CORS
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || "Unknown error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
