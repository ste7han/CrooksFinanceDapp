// Place this file as: /functions/rpc.ts  (-> route: /rpc)
// or                /functions/rpc-cronos.ts (-> route: /rpc-cronos)

function getTarget(env: any) {
  const raw = (env?.CRONOS_RPC_URL || "https://evm.cronos.org").trim();
  // avoid trailing slash; some JSON-RPC servers are picky
  return raw.replace(/\/+$/, "");
}

// --- CORS helpers ---
const corsBase = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-requested-with, *",
  "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
  "Cache-Control": "no-store",
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { status: 204, headers: corsBase });

export const onRequestGet: PagesFunction = async ({ env }) => {
  const target = getTarget(env);
  return new Response(JSON.stringify({ ok: true, upstream: target }), {
    status: 200,
    headers: { ...corsBase, "content-type": "application/json" },
  });
};

export const onRequestPost: PagesFunction = async ({ request, env }) => {
  const target = getTarget(env);

  // Read raw body once (JSON-RPC)
  const bodyText = await request.text();

  const upstream = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: bodyText,
    // @ts-ignore
    keepalive: true,
  });

  const text = await upstream.text(); // pass-through

  return new Response(text, {
    status: upstream.status,
    headers: { ...corsBase, "content-type": "application/json" },
  });
};

// Optional: catch-all (only if you kept export onRequest* above)
// export const onRequest: PagesFunction = onRequestPost;
