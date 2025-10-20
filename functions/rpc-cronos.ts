export const onRequest: PagesFunction = async ({ request }) => {
  const target = "https://evm.cronos.org/"; // ⬅️ switch van ankr → cronos

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
    });
  }

  const init: RequestInit = {
    method: request.method,
    headers: { "content-type": "application/json" },
    body: request.method === "POST" ? await request.text() : undefined,
    // keepalive kan helpen bij snellere closes:
    // @ts-ignore
    keepalive: true,
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
