// Place as /functions/rpc.ts  -> route: /rpc
//   or   as /functions/rpc-cronos.ts -> route: /rpc-cronos
// Cloudflare Pages Functions

function getTarget(env: any) {
  const raw = (env?.CRONOS_RPC_URL || "https://evm.cronos.org").trim();
  return raw.replace(/\/+$/, ""); // no trailing slash
}

// --- CORS / cache headers ---
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-requested-with, *",
  "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
  "Cache-Control": "no-store",
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: corsHeaders });

export const onRequestGet: PagesFunction = async ({ env }) => {
  const target = getTarget(env);
  return new Response(JSON.stringify({ ok: true, upstream: target }), {
    status: 200,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
};

export const onRequestPost: PagesFunction = async ({ request, env, waitUntil }) => {
  const target = getTarget(env);

  // Read JSON-RPC body once (as text, pass-through)
  let bodyText = "";
  try {
    bodyText = await request.text();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Failed to read request body" }), {
      status: 400,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }

  // Abort after 20s to avoid hanging connections
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), 20_000);
  // ensure the timer is cleared even if the request outlives the response
  waitUntil(Promise.resolve().then(() => clearTimeout(timeout)));

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        // Keep it minimal; upstream JSON-RPC expects this header only
        "content-type": "application/json",
      },
      body: bodyText,
      signal: ac.signal,
      // @ts-ignore
      keepalive: true,
    });

    const text = await upstream.text(); // pass-through

    // Some RPCs return non-200 with JSON error objects. We pass status through.
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        // Most JSON-RPC servers reply with application/json
        "content-type": upstream.headers.get("content-type") || "application/json",
      },
    });
  } catch (err: any) {
    const msg =
      err?.name === "AbortError"
        ? "Upstream timeout"
        : (err?.message || "Upstream fetch failed");

    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } finally {
    clearTimeout(timeout);
  }
};

// Optional: if you prefer a single export instead of method-specific handlers,
// uncomment the line below (and remove onRequestGet/Options above).
// export const onRequest: PagesFunction = onRequestPost;
