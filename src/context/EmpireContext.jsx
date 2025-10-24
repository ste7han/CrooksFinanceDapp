// src/context/EmpireContext.jsx
import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useWallet } from "./WalletContext";

/* ---------------- ENV ---------------- */
/** Pages Functions base for stamina. Leave empty to use same-origin relative path */
const PAGES_API = (import.meta.env.VITE_PAGES_API || "").replace(/\/$/, "");

/* -------- Local storage keys (non-stamina only) -------- */
const LS_KEY = "crooks:empire:store:v1";

/* ---------------- Initial store ---------------- */
const initialStore = {
  wallet: "",
  faction: null, // { id, name, token, logo, initials }
  factionPointsWeek: 0,
  factionPointsMonth: 0,
  tokensEarned: {
    CRKS: 0,
    CRO: 0,
    CROCARD: 0,
    MOON: 0,
    BOBZ: 0,
    BONE: 0,
    CRY: 0,
    KRIS: 0,
  },
  heists: { played: 0, wins: 0, losses: 0 },
  // shadow stamina for legacy reads (backend is the source of truth)
  stamina: 0,
};

/* ---------------- Persistence ---------------- */
function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw);
    return { ...initialStore, ...parsed };
  } catch {
    return initialStore;
  }
}
function saveStore(s) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {}
}

/* ---------------- Context shape ---------------- */
const EmpireCtx = createContext({
  state: initialStore,

  // general mutators
  setFaction: () => {},
  clearFaction: () => {},
  awardTokens: () => {},
  recordHeist: () => {},
  hydrateFromWallet: () => {},
  resetWeek: () => {},
  resetMonth: () => {},

  // backend stamina
  stamina: null,
  staminaCap: null,
  staminaPct: 0,
  rankName: null,
  nextTickMs: 0,
  nextTickAt: null,
  refreshStamina: () => Promise.resolve(),

  // legacy helpers (kept for compatibility)
  setStamina: () => {},
  initStaminaIfNeeded: () => {},
  tickStamina: () => {},
  getStaminaProgress: () => ({
    cap: 0,
    stamina: 0,
    pctToNext: 0,
    msToNext: 0,
    nextAt: null,
    isFull: true,
  }),
});

const HOUR_MS = 60 * 60 * 1000;

/* ---------------- Provider ---------------- */
export function EmpireProvider({ children }) {
  const [state, setState] = useState(() => loadStore());
  const { address } = useWallet();

  // backend stamina state
  const [rankName, setRankName] = useState(null);
  const [stamina, setStaminaVal] = useState(null);
  const [staminaCap, setStaminaCap] = useState(null);
  const [lastTickAt, setLastTickAt] = useState(null); // ISO string from backend

  // a 1s ticker so countdown updates visually
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // persist non-stamina state
  useEffect(() => {
    saveStore(state);
  }, [state]);

  /* ---------- general mutators ---------- */
  const setFaction = useCallback((f) => {
    setState((prev) => ({ ...prev, faction: f }));
  }, []);

  const clearFaction = useCallback(() => {
    setState((prev) => ({ ...prev, faction: null }));
  }, []);

  const awardTokens = useCallback((deltaMap = {}, { addFactionPoints = 0 } = {}) => {
    setState((prev) => {
      const nextTokens = { ...prev.tokensEarned };
      for (const [sym, amt] of Object.entries(deltaMap)) {
        const n = Number(amt) || 0;
        nextTokens[sym] = Math.max(0, (Number(nextTokens[sym]) || 0) + n);
      }
      const next = { ...prev, tokensEarned: nextTokens };
      if (addFactionPoints && prev.faction) {
        next.factionPointsWeek =
          Math.max(0, (prev.factionPointsWeek || 0) + addFactionPoints);
        next.factionPointsMonth =
          Math.max(0, (prev.factionPointsMonth || 0) + addFactionPoints);
      }
      return next;
    });
  }, []);

  const recordHeist = useCallback((result) => {
    setState((prev) => {
      const h = { ...prev.heists };
      h.played = (h.played || 0) + 1;
      if (result === "win") h.wins = (h.wins || 0) + 1;
      if (result === "loss") h.losses = (h.losses || 0) + 1;
      return { ...prev, heists: h };
    });
  }, []);

  const hydrateFromWallet = useCallback((wallet) => {
    if (!wallet) return;
    setState((prev) => (prev.wallet === wallet ? prev : { ...prev, wallet }));
  }, []);

  const resetWeek = useCallback(() => {
    setState((prev) => ({ ...prev, factionPointsWeek: 0 }));
  }, []);

  const resetMonth = useCallback(() => {
    setState((prev) => ({ ...prev, factionPointsMonth: 0 }));
  }, []);

  /* ---------- backend stamina fetch (defensive parse + fallback) ---------- */
  const refreshStamina = useCallback(async () => {
    try {
      if (!address) {
        setRankName(null);
        setStaminaVal(null);
        setStaminaCap(null);
        setLastTickAt(null);
        return;
      }

      // Probeer beide routes: /api/me/stamina en /me/stamina
      const base = (PAGES_API || "").replace(/\/$/, "");
      const candidates = [`${base}/api/me/stamina`, `${base}/me/stamina`];

      let j = null;
      let lastErr = null;

      for (const url of candidates) {
        try {
          const res = await fetch(url, {
            headers: { "X-Wallet-Address": address },
            cache: "no-store",
          });
          const text = await res.text();
          if (!text) throw new Error("empty response");
          j = JSON.parse(text);
          // minimaal verwacht veld
          if (typeof j === "object" && ("stamina" in j || "cap" in j)) {
            break; // gelukt
          } else {
            throw new Error("json missing fields");
          }
        } catch (e) {
          lastErr = e;
          j = null;
        }
      }

      if (!j) throw lastErr || new Error("no valid stamina endpoint");

      // expected: { wallet, user_id, rank, stamina, cap, updated_at, last_tick_at }
      setRankName(j.rank ?? null);
      setStaminaVal(Number(j.stamina ?? 0));
      setStaminaCap(Number(j.cap ?? 0));
      setLastTickAt(j.last_tick_at ?? j.updated_at ?? null);

      // shadow stamina voor legacy onderdelen
      setState((prev) => ({
        ...prev,
        stamina: Number(j.stamina ?? 0),
        wallet: address,
      }));
    } catch (e) {
      console.warn("[Crooks] failed to sync user:", e);
      // waarden blijven zoals ze waren; UI toont "— / —" bij nulls
      setStaminaVal(null);
      setStaminaCap(null);
    }
  }, [address]);


  // initial + on wallet change
  useEffect(() => {
    refreshStamina();
  }, [refreshStamina]);

  /* ---------- derived UI values ---------- */
  const staminaPct = useMemo(() => {
    if (stamina == null || staminaCap == null || staminaCap <= 0) return 0;
    return Math.max(0, Math.min(100, (stamina / staminaCap) * 100));
  }, [stamina, staminaCap]);

  const { nextTickMs, nextTickAt } = useMemo(() => {
    if (stamina == null || staminaCap == null) return { nextTickMs: 0, nextTickAt: null };
    const full = staminaCap === 0 || stamina >= staminaCap;
    if (full) return { nextTickMs: 0, nextTickAt: null };
    const last = lastTickAt ? Date.parse(lastTickAt) : Date.now();
    const now = Date.now();
    const elapsed = now - last;
    const intoHour = elapsed % HOUR_MS;
    const msToNext = Math.max(0, HOUR_MS - intoHour);
    return { nextTickMs: msToNext, nextTickAt: new Date(now + msToNext).toISOString() };
  }, [stamina, staminaCap, lastTickAt]);

  /* ---------- legacy wrappers (no server mutation) ---------- */
  const setStamina = useCallback(
    (valueOrUpdater) => {
      setState((prev) => {
        const nextVal =
          typeof valueOrUpdater === "function"
            ? valueOrUpdater(prev.stamina)
            : valueOrUpdater;
        return { ...prev, stamina: Math.max(0, Number(nextVal) || 0) };
      });
      refreshStamina().catch(() => {});
    },
    [refreshStamina]
  );

  const initStaminaIfNeeded = useCallback(() => {}, []);
  const tickStamina = useCallback(() => {}, []);

  const getStaminaProgress = useCallback(() => {
    const s = Number(stamina ?? 0);
    const cap = Number(staminaCap ?? 0);
    const isFull = cap === 0 || s >= cap;

    if (isFull) {
      return {
        cap,
        stamina: s,
        pctToNext: 1,
        msToNext: 0,
        nextAt: null,
        isFull: true,
      };
    }
    const last = lastTickAt ? Date.parse(lastTickAt) : Date.now();
    const now = Date.now();
    const elapsed = now - last;
    const intoHour = elapsed % HOUR_MS;
    const pctToNext = Math.min(1, intoHour / HOUR_MS);
    const nextAt = last + (Math.floor(elapsed / HOUR_MS) + 1) * HOUR_MS;
    const msToNext = Math.max(0, nextAt - now);

    return { cap, stamina: s, pctToNext, msToNext, nextAt, isFull: false };
  }, [stamina, staminaCap, lastTickAt]);

  /* ---------- value ---------- */
  const value = useMemo(
    () => ({
      state,
      setFaction,
      clearFaction,
      awardTokens,
      recordHeist,
      hydrateFromWallet,
      resetWeek,
      resetMonth,

      stamina,
      staminaCap,
      staminaPct,
      rankName,
      nextTickMs,
      nextTickAt,
      refreshStamina,

      setStamina, // legacy shadow
      initStaminaIfNeeded,
      tickStamina,
      getStaminaProgress,
    }),
    [
      state,
      setFaction,
      clearFaction,
      awardTokens,
      recordHeist,
      hydrateFromWallet,
      resetWeek,
      resetMonth,
      stamina,
      staminaCap,
      staminaPct,
      rankName,
      nextTickMs,
      nextTickAt,
      refreshStamina,
      setStamina,
      initStaminaIfNeeded,
      tickStamina,
      getStaminaProgress,
    ]
  );

  return <EmpireCtx.Provider value={value}>{children}</EmpireCtx.Provider>;
}

/* ---------------- Hook ---------------- */
export function useEmpire() {
  return useContext(EmpireCtx);
}
