// functions/_worker.js
const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const cors = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization,x-wallet-address,X-Wallet-Address",
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    const res = await env.ASSETS.fetch(request, ctx); // laat file-based routes hun werk doen
    // voeg CORS toe aan elke response
    const newHeaders = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) newHeaders.set(k, v);
    return new Response(res.body, { status: res.status, headers: newHeaders });
  },
};
