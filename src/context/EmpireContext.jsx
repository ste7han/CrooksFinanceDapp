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

// ------- ENV -------
const API = import.meta.env.VITE_API_BASE;

// ------- Local storage keys (keep for non-stamina bits) -------
const LS_KEY = "crooks:empire:store:v1";

// ------- Initial store (keep your local stats/tokens etc) -------
const initialStore = {
  wallet: "",
  faction: null, // { id, name, token, logo, initials }
  factionPointsWeek: 0,
  factionPointsMonth: 0,
  tokensEarned: { CRKS: 0, CRO: 0, CROCARD: 0, MOON: 0, BOBZ: 0, BONE: 0, CRY: 0, KRIS: 0 },
  heists: { played: 0, wins: 0, losses: 0 },
  // NOTE: client-side stamina is no longer authoritative; we keep a shadow value for legacy calls
  stamina: 0,
};

// ------- Persistence for non-stamina state -------
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
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

// ===================================================
// Context
// ===================================================
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

  // ---- Stamina (backend authoritative) ----
  stamina: null,          // number | null (null while loading)
  staminaCap: null,       // number | null
  staminaPct: 0,          // 0..100 (fill of total capacity)
  rankName: null,         // string | null
  nextTickMs: 0,          // ms to next +1 (0 if full or cap===0)
  nextTickAt: null,       // timestamp | null
  refreshStamina: () => {},

  // legacy helpers kept for compatibility (no-ops or wrappers)
  setStamina: () => {},
  initStaminaIfNeeded: () => {},
  tickStamina: () => {},
  getStaminaProgress: () => ({ cap: 0, stamina: 0, pctToNext: 0, msToNext: 0, nextAt: null, isFull: true }),
});

// regen config (matches backend/mechanics)
const REGEN_PER_HOUR = 1;    // +1/hour
const HOUR_MS = 60 * 60 * 1000;

// ===================================================
// Provider
// ===================================================
export function EmpireProvider({ children }) {
  const [state, setState] = useState(() => loadStore());
  const { address } = useWallet();

  // ---- Backend stamina state ----
  const [rankName, setRankName] = useState(null);
  const [stamina, setStaminaVal] = useState(null);
  const [staminaCap, setStaminaCap] = useState(null);
  const [lastTickAt, setLastTickAt] = useState(null); // ISO string from backend

  // persist non-stamina state
  useEffect(() => { saveStore(state); }, [state]);

  // --------------------------------
  // General mutators (unchanged)
  // --------------------------------
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
        next.factionPointsWeek  = Math.max(0, (prev.factionPointsWeek  || 0) + addFactionPoints);
        next.factionPointsMonth = Math.max(0, (prev.factionPointsMonth || 0) + addFactionPoints);
      }
      return next;
    });
  }, []);

  const recordHeist = useCallback((result /* "win" | "loss" */) => {
    setState((prev) => {
      const h = { ...prev.heists };
      h.played = (h.played || 0) + 1;
      if (result === "win")  h.wins  = (h.wins  || 0) + 1;
      if (result === "loss") h.losses = (h.losses || 0) + 1;
      return { ...prev, heists: h };
    });
  }, []);

  const hydrateFromWallet = useCallback((wallet) => {
    if (!wallet) return;
    setState((prev) => prev.wallet === wallet ? prev : { ...prev, wallet });
  }, []);

  const resetWeek = useCallback(() => {
    setState((prev) => ({ ...prev, factionPointsWeek: 0 }));
  }, []);

  const resetMonth = useCallback(() => {
    setState((prev) => ({ ...prev, factionPointsMonth: 0 }));
  }, []);

  // ===================================================
  // Stamina: backend-authoritative fetch & calculations
  // ===================================================
  const refreshStamina = useCallback(async () => {
    try {
      if (!address) {
        setRankName(null);
        setStaminaVal(null);
        setStaminaCap(null);
        setLastTickAt(null);
        return;
    }
      const r = await fetch(`${API}/api/me/stamina`, {
        headers: { "X-Wallet-Address": address },
      });
      const j = await r.json();
      // j = { rank, stamina, cap, last_tick_at/updated_at }
      setRankName(j.rank ?? null);
      setStaminaVal(Number(j.stamina ?? 0));
      setStaminaCap(Number(j.cap ?? 0));
      setLastTickAt(j.last_tick_at ?? j.updated_at ?? null);

      // keep shadow stamina for any legacy reads of state.stamina
      setState((prev) => ({ ...prev, stamina: Number(j.stamina ?? 0), wallet: address }));
    } catch (e) {
      console.error("[Empire] stamina refresh failed", e);
    }
  }, [address]);

  // refresh whenever wallet changes
  useEffect(() => { refreshStamina(); }, [refreshStamina]);

  // capacity fill %
  const staminaPct = useMemo(() => {
    if (stamina == null || staminaCap == null || staminaCap <= 0) return 0;
    return Math.max(0, Math.min(100, (stamina / staminaCap) * 100));
  }, [stamina, staminaCap]);

  // next tick countdown (client-side, visual only)
  const { nextTickMs, nextTickAt } = useMemo(() => {
    if (stamina == null || staminaCap == null) return { nextTickMs: 0, nextTickAt: null };
    const isFull = staminaCap === 0 || stamina >= staminaCap;
    if (isFull) return { nextTickMs: 0, nextTickAt: null };
    const last = lastTickAt ? Date.parse(lastTickAt) : Date.now();
    const now = Date.now();
    const elapsed = now - last;
    const intoHour = elapsed % HOUR_MS;
    const msToNext = Math.max(0, HOUR_MS - intoHour);
    return { nextTickMs: msToNext, nextTickAt: new Date(now + msToNext).toISOString() };
  }, [stamina, staminaCap, lastTickAt]);

  // ===================================================
  // Legacy stamina helpers (kept to avoid breaking callers)
  // These now defer to backend values and do NOT mutate server state.
  // ===================================================
  const setStamina = useCallback((valueOrUpdater) => {
    // Keep a local shadow for legacy callers, but refresh from backend right after.
    setState((prev) => {
      const nextVal = typeof valueOrUpdater === "function"
        ? valueOrUpdater(prev.stamina)
        : valueOrUpdater;
      return { ...prev, stamina: Math.max(0, Number(nextVal) || 0) };
    });
    // ensure we re-sync with backend
    refreshStamina();
  }, [refreshStamina]);

  const initStaminaIfNeeded = useCallback((_rankName) => {
    // No-op now; stamina is initialized server-side when /api/me/stamina is called.
    return;
  }, []);

  const tickStamina = useCallback((_rankName) => {
    // No-op; regen is visual here. Call refreshStamina() if you want fresh numbers from server.
    return;
  }, []);

  const getStaminaProgress = useCallback((_rankName) => {
    const s = Number(stamina ?? 0);
    const cap = Number(staminaCap ?? 0);
    const isFull = cap === 0 || s >= cap;

    if (isFull) {
      return { cap, stamina: s, pctToNext: 1, msToNext: 0, nextAt: null, isFull: true };
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

  // ===================================================
  // Context value
  // ===================================================
  const value = useMemo(() => ({
    state,
    setFaction,
    clearFaction,
    awardTokens,
    recordHeist,
    hydrateFromWallet,
    resetWeek,
    resetMonth,

    // backend stamina
    stamina,
    staminaCap,
    staminaPct,
    rankName,
    nextTickMs,
    nextTickAt,
    refreshStamina,

    // legacy-compatible helpers
    setStamina,
    initStaminaIfNeeded,
    tickStamina,
    getStaminaProgress,
  }), [
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
  ]);

  return <EmpireCtx.Provider value={value}>{children}</EmpireCtx.Provider>;
}

// Hook
export function useEmpire() {
  return useContext(EmpireCtx);
}
