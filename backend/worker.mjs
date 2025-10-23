// backend/worker.mjs
import { createClient } from "@supabase/supabase-js";

// CORS helper (zet je eigen domein hier)
const ALLOW_ORIGIN = "*"; // of "https://jouw-frontend.domain"
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...extra },
  });
}

export default {
  async fetch(request, env) {
    // Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // Supabase server-client (service role! alleen server-side)
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
      global: { headers: { "x-client-info": "crooks-backend" } },
    });

    // GET /api/health -> test DB-toegang
    if (path === "/api/health" && request.method === "GET") {
      const { error } = await supabase.from("heists").select("id").limit(1);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    // POST /api/me -> upsert user by wallet
    if (path === "/api/me" && request.method === "POST") {
      const { wallet } = await request.json().catch(() => ({}));
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) {
        return json({ error: "Invalid wallet" }, 400);
      }
      const lower = wallet.toLowerCase();

      const { data, error } = await supabase
        .from("users")
        .upsert({ wallet: lower }, { onConflict: "wallet" })
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ user: data });
    }

    // POST /api/progress -> voorbeeld: gameplay event loggen
    if (path === "/api/progress" && request.method === "POST") {
      const { wallet, action, payload } = await request.json().catch(() => ({}));
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) {
        return json({ error: "Invalid wallet" }, 400);
      }
      if (!action) return json({ error: "Missing action" }, 400);

      const { data, error } = await supabase
        .from("events")
        .insert({
          wallet: wallet.toLowerCase(),
          action,
          payload: payload ?? null, // JSONB kolom in schema is ideaal
        })
        .select()
        .single();

      if (error) return json({ error: error.message }, 500);
      return json({ ok: true, event: data });
    }

    return json({ error: "Not found" }, 404);
  },
};
