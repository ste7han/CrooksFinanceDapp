import { ethers } from "ethers";

export async function onRequestGet(context) {
  try {
    const nftAddress = "0x44102b7ab3e2b8edf77d188cd2b173ecbda60967";
    const moralisKey = context.env.MORALIS_KEY;

    if (!moralisKey) {
      return new Response(
        JSON.stringify({ error: "Missing MORALIS_KEY in environment" }),
        { status: 500 }
      );
    }

    const urlObj = new URL(context.request.url);
    const limit = Number(urlObj.searchParams.get("limit")) || 10;

    // ✅ Using Moralis NFT transfers as backup
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

    // 🧠 Helper to format CRO units safely
    const toEth = (val) => {
      try {
        return ethers.formatUnits(val || "0", 18);
      } catch {
        return "0";
      }
    };

    // 🧩 Normalize structure for frontend
    const list = Array.isArray(data?.result)
      ? data.result.map((ev) => ({
          type: "Sold",
          price: toEth(ev.price || ev.value || ev.amount),
          nftId: ev.token_id,
          nftAddress: ev.token_address,
          saleTime: Math.floor(
            new Date(ev.block_timestamp).getTime() / 1000
          ),
          listingId: ev.transaction_hash,
          currency: "CRO",
          nft: {
            image: ev.token_image || "",
            name: ev.token_name || `#${ev.token_id}`,
          },
        }))
      : [];

    return new Response(JSON.stringify(list), {
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
