export const onRequest: PagesFunction = async (ctx) => {
  const target = "https://rpc.ankr.com/cronos";

  const req = ctx.request;
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
    });
  }

  // Forward JSON-RPC (meestal POST)
  const init: RequestInit = {
    method: req.method,
    headers: { "content-type": "application/json" },
    body: req.method === "POST" ? await req.text() : undefined,
  };

  const upstream = await fetch(target, init);
  const body = await upstream.text();

  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
};
