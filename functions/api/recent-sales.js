// functions/api/recent-sales.js
// Cloudflare Pages Function — generic Moralis proxy (Cronos)
// NOTE: Moralis "trades" isn’t available for Cronos on the free tier.
// We use /transfers as a lightweight recent-activity fallback.

export async function onRequestGet(context) {
  try {
    const moralisKey = context.env.MORALIS_KEY;
    if (!moralisKey) {
      return new Response(
        JSON.stringify({ error: "Missing MORALIS_KEY in environment" }),
        { status: 500 }
      );
    }

    const urlObj = new URL(context.request.url);
    // allow overriding collection via ?address=
    const nftAddress =
      (urlObj.searchParams.get("address") || "").trim() ||
      "0x44102b7ab3e2b8edf77d188cd2b173ecbda60967"; // default: Crooks Legends
    const limit = Math.min(
      50,
      Math.max(1, Number(urlObj.searchParams.get("limit")) || 10)
    );

    // Moralis transfers (works on Cronos)
    const url = `https://deep-index.moralis.io/api/v2/nft/${nftAddress}/transfers?chain=cronos&limit=${limit}`;

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

    return new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
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
