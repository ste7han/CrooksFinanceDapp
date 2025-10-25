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

const HOUR_MS = 60 * 60 * 1000; // 1 ⚡ per uur

// Rank → cap (zoals bij jou)
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

    // Huidige state ophalen
    const sel = await sb
      .from("stamina_states")
      .select("stamina,cap,updated_at,last_tick_at")
      .eq("user_id", userId)
      .single();

    // Eerste keer → rij aanmaken
    if (sel.error && sel.error.code === "PGRST116") {
      const nowIso = new Date().toISOString();
      const payload = {
        user_id: userId,
        stamina: 0,
        cap,
        last_tick_at: nowIso,
      };
      const up = await sb.from("stamina_states").upsert(payload, { onConflict: "user_id" });
      if (up.error) return json({ error: up.error.message }, 500);

      // Volgende tick-informatie voor UI
      return json({
        wallet,
        user_id: userId,
        rank: rankName,
        stamina: 0,
        cap,
        fresh: true,
        updated_at: nowIso,
        last_tick_at: nowIso,
        gained: 0,
        next_tick_ms: cap === 0 ? 0 : HOUR_MS, // over een uur +1 (tenzij cap=0)
      });
    }
    if (sel.error) return json({ error: sel.error.message }, 500);

    // Auto-regen
    let stamina = Number(sel.data?.stamina || 0);
    const prevCap = Number(sel.data?.cap ?? cap);
    const lastTickAtIso = sel.data?.last_tick_at || new Date().toISOString();
    const lastTick = Date.parse(lastTickAtIso) || Date.now();
    const now = Date.now();

    // Als cap is gewijzigd door rank, forceer clamp
    if (prevCap !== cap) {
      stamina = Math.min(stamina, cap);
    }

    // Hoeveel uur voorbij?
    const elapsedHours = Math.floor((now - lastTick) / HOUR_MS);
    const room = Math.max(0, cap - stamina);
    const gained = Math.max(0, Math.min(room, elapsedHours));

    // Als we iets toevoegen, schuif last_tick_at mee met precies 'gained' uren
    let newLastTick = lastTick;
    if (gained > 0) {
      stamina += gained;
      newLastTick = lastTick + gained * HOUR_MS;

      const up = await sb
        .from("stamina_states")
        .upsert(
          {
            user_id: userId,
            stamina,
            cap,
            last_tick_at: new Date(newLastTick).toISOString(),
          },
          { onConflict: "user_id" }
        );
      if (up.error) return json({ error: up.error.message }, 500);
    } else if (prevCap !== cap) {
      // Alleen cap wijzigde? Sla dat ook even op (en clampte stamina al hierboven)
      const up = await sb
        .from("stamina_states")
        .upsert(
          { user_id: userId, stamina, cap },
          { onConflict: "user_id" }
        );
      if (up.error) return json({ error: up.error.message }, 500);
    }

    // Bereken ms tot volgende +1 voor de UI (0 als full of cap=0)
    let next_tick_ms = 0;
    if (cap > 0 && stamina < cap) {
      const sinceLast = now - newLastTick;
      const intoHour = sinceLast % HOUR_MS;
      next_tick_ms = Math.max(0, HOUR_MS - intoHour);
    }

    return json({
      wallet,
      user_id: userId,
      rank: rankName,
      stamina,
      cap,
      updated_at: sel.data?.updated_at || null,
      last_tick_at: new Date(newLastTick).toISOString(),
      gained,
      next_tick_ms,
    });
  } catch (e) {
    return json({ error: e.message || "stamina fetch failed" }, 500);
  }
}
