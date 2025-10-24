// functions/api/me/index.js
import { createClient } from "@supabase/supabase-js";

const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  // let op: include lower- & mixed-case voor sommige browsers
  "Access-Control-Allow-Headers": "content-type,authorization,x-wallet-address,X-Wallet-Address",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...extra },
  });

export const onRequestOptions = () => new Response(null, { headers: corsHeaders });

export async function onRequestPost({ request, env }) {
  try {
    const { wallet } = await request.json().catch(() => ({}));
    if (!/^0x[a-fA-F0-9]{40}$/.test(wallet || "")) {
      return json({ error: "Invalid wallet" }, 400);
    }
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
      auth: { persistSession: false },
      global: { headers: { "x-client-info": "crooks-backend" } },
    });

    const lower = wallet.toLowerCase();
    const { data, error } = await supabase
      .from("users")
      .upsert({ wallet_address: lower }, { onConflict: "wallet_address" })
      .select("id,wallet_address")
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ user: { id: data.id, wallet: data.wallet_address } });
  } catch (e) {
    return json({ error: e.message || "me upsert failed" }, 500);
  }
}
