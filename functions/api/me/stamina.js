// functions/api/me/stamina.js
import { createClient } from "@supabase/supabase-js";

const ALLOW_ORIGIN = "https://crooksfinancedapp.pages.dev";
const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "content-type,authorization,x-wallet-address,X-Wallet-Address",
};

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders, ...extra },
  });

const RANK_CAPS = {
  Prospect: 0, Member: 2, Hustler: 4, "Street Soldier": 6, Enforcer: 8,
  Officer: 10, Captain: 12, General: 14, "Gang Leader": 16, Boss: 18,
  Kingpin: 18, Overlord: 19, Icon: 19, Legend: 20, Immortal: 20,
};
const capForRank = (name) => RANK_CAPS[name] ?? 0;

function getWalletLowerFromAny(request, url) {
  let w = request.headers.get("X-Wallet-Address") || request.headers.get("x-wallet-address");
  if (!w) {
    const auth = request.headers.get("Authorization") || "";
    const m = auth.match(/^Bearer\s+(0x[a-fA-F0-9]{40})$/);
    if (m) w = m[1];
  }
  if (!w) w = url.searchParams.get("wallet") || "";
  if (!/^0x[a-fA-F0-9]{40}$/.test(w)) return null;
  return w.toLowerCase();
}

async function getOrCreateUserId(sb, walletLower) {
  const { data, error } = await sb
    .from("users")
    .upsert({ wallet_address: walletLower }, { onConflict: "wallet_address" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function getRankNameForUser_dbFirst(sb, userId) {
  const view = await sb.from("v_user_rank").select("rank_name").eq("user_id", userId).single();
  if (!view.error && view.data?.rank_name) return view.data.rank_name;

  const users = await sb.from("users").select("rank_name,rank").eq("id", userId).single();
  if (!users.error) return users.data?.rank_name || users.data?.rank || "Prospect";
  return "Prospect";
}

export const onRequestOptions = () => new Response(null, { headers: corsHeaders });

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const wallet = getWalletLowerFromAny(request, url);
  if (!wallet) return json({ error: "Missing or invalid wallet" }, 400);

  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE, {
    auth: { persistSession: false },
    global: { headers: { "x-client-info": "crooks-backend" } },
  });

  try {
    const userId = await getOrCreateUserId(sb, wallet);
    const rankName = await getRankNameForUser_dbFirst(sb, userId);
    const cap = capForRank(rankName);

    const sel = await sb
      .from("stamina_states")
      .select("stamina,cap,updated_at,last_tick_at")
      .eq("user_id", userId)
      .single();

    if (sel.error && sel.error.code === "PGRST116") {
      const payload = {
        user_id: userId,
        stamina: 0,
        cap,
        last_tick_at: new Date().toISOString(),
      };
      const up = await sb.from("stamina_states").upsert(payload, { onConflict: "user_id" });
      if (up.error) return json({ error: up.error.message }, 500);
      return json({ wallet, user_id: userId, rank: rankName, stamina: 0, cap, fresh: true });
    }
    if (sel.error) return json({ error: sel.error.message }, 500);

    let stamina = Number(sel.data?.stamina || 0);
    if (sel.data?.cap !== cap) {
      stamina = Math.min(stamina, cap);
      await sb.from("stamina_states").upsert({ user_id: userId, stamina, cap }, { onConflict: "user_id" });
    }

    return json({
      wallet,
      user_id: userId,
      rank: rankName,
      stamina,
      cap,
      updated_at: sel.data?.updated_at,
      last_tick_at: sel.data?.last_tick_at,
    });
  } catch (e) {
    return json({ error: e.message || "stamina fetch failed" }, 500);
  }
}
