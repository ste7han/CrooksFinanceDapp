export const onRequestGet: PagesFunction<{
  VITE_EBISUS_API: string | undefined;
}> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();

  if (!addr) {
    return new Response("addr query param required\n", { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const write = (s: string) => controller.enqueue(new TextEncoder().encode(s));

      // Helper to send SSE event
      const send = (event: string, data: unknown) => {
        write(`event: ${event}\n`);
        write(`data: ${JSON.stringify(data)}\n\n`);
      };

      // Always greet
      send("hello", { ok: true });

      // If there’s no upstream configured, just keep the pipe alive with pings.
      const base = ctx.env.VITE_EBISUS_API?.trim();
      if (!base) {
        console.warn("[ebisus-feed] VITE_EBISUS_API is not set – streaming pings only");
        const ping = setInterval(() => send("ping", { t: Date.now() }), 15000);
        // Close on client abort
        ctx.request.signal.addEventListener("abort", () => {
          clearInterval(ping);
          controller.close();
        });
        return;
      }

      // 🔧 TODO: Replace this with a *real* upstream stream or polling loop to Ebisu.
      // As a safe default, we’ll do a very light polling loop to your recent endpoint
      // (which itself proxies the API) and emit any new items.
      let lastSeenTs = 0;

      const loop = async () => {
        if (ctx.request.signal.aborted) return;

        try {
          const recentUrl = new URL(url.origin + "/ebisus-recent");
          recentUrl.searchParams.set("addr", addr);
          recentUrl.searchParams.set("limit", "4");
          const r = await fetch(recentUrl.toString(), { headers: { accept: "application/json" } });
          if (r.ok) {
            const arr = await r.json().catch(() => []);
            // Expect the array to have time/saleTime etc; filter new and emit
            const items = Array.isArray(arr) ? arr : [];
            // Try to infer timestamp field
            const normalized = items.map((it: any) => {
              const t =
                Number(it?.saleTime ?? it?.listingTime ?? it?.time ?? 0) || 0;
              return { type: it?.type || "Sold", time: t, raw: it };
            });

            // newest first
            normalized.sort((a, b) => (b.time || 0) - (a.time || 0));

            for (const n of normalized) {
              if (n.time && n.time > lastSeenTs) {
                lastSeenTs = n.time;
                send("sold", n.raw); // FE already normalizes
              }
            }
          } else {
            send("error", { error: "poll_failed" });
          }
        } catch (e) {
          console.error("[ebisus-feed] poll error:", e);
          send("error", { error: "poll_failed" });
        }

        // schedule next poll
        setTimeout(loop, 12000);
      };

      loop();

      // keepalive ping so proxies don’t drop us
      const ping = setInterval(() => send("ping", { t: Date.now() }), 15000);

      // Close if client disconnects
      ctx.request.signal.addEventListener("abort", () => {
        clearInterval(ping);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "connection": "keep-alive",
      "access-control-allow-origin": "*",
    },
  });
};
