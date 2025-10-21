// /functions/ebisus-feed.ts
//
// Ebisu’s Bay poller -> SSE bridge
// Polls recent sales from the Ebisu API every ~15 seconds
// and streams them as Server-Sent Events to the DApp.
//

export const onRequestGet: PagesFunction<{
  VITE_EBISUS_API: string | undefined;
}> = async (ctx) => {
  const { env } = ctx;
  const url = new URL(ctx.request.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();
  if (!addr) return new Response("addr required", { status: 400 });

  const base = (env.VITE_EBISUS_API || "https://api.ebisusbay.com").replace(/\/+$/, "");
  const salesEndpoint = `${base}/api/v2/events/sales?collection_address=${addr}&limit=8`;

  const stream = new ReadableStream({
    start(controller) {
      const write = (s: string) => controller.enqueue(new TextEncoder().encode(s));
      const send = (event: string, data: unknown) => {
        write(`event: ${event}\n`);
        write(`data: ${JSON.stringify(data)}\n\n`);
      };

      send("hello", { ok: true, source: "ebisus-feed" });

      let lastTs = 0;

      async function poll() {
        if (ctx.request.signal.aborted) return;

        try {
          const r = await fetch(salesEndpoint, { headers: { accept: "application/json" } });
          if (r.ok) {
            const json = await r.json();
            const items = Array.isArray(json) ? json : json?.items || [];

            // Sort newest first and emit if newer than lastTs
            items
              .map((it: any) => ({
                type: "Sold",
                time: Number(it?.timestamp ?? it?.sale_time ?? it?.block_timestamp ?? 0),
                raw: it,
              }))
              .filter((it) => it.time > 0)
              .sort((a, b) => b.time - a.time)
              .forEach((it) => {
                if (it.time > lastTs) {
                  lastTs = it.time;
                  send("sold", it.raw);
                }
              });
          } else {
            send("error", { status: r.status, msg: r.statusText });
          }
        } catch (e) {
          console.error("[ebisus-feed] poll error", e);
          send("error", { msg: String(e) });
        }

        setTimeout(poll, 15000); // repeat every 15s
      }

      poll();

      // keep-alive ping
      const ping = setInterval(() => send("ping", { t: Date.now() }), 15000);

      ctx.request.signal.addEventListener("abort", () => {
        clearInterval(ping);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "connection": "keep-alive",
      "access-control-allow-origin": "*",
    },
  });
};
