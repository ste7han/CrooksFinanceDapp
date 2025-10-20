// src/context/EmpireContext.jsx
import React, {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
  useState,
} from "react";

/** -----------------------------
 *  Local storage keys
 *  ----------------------------- */
const LS_KEY = "crooks:empire:store:v1";        // main game store (JSON)
const STAM_TS_KEY = "crooks:empire:stamina_ts"; // last stamina regen timestamp (ms)

/** -----------------------------
 *  Initial store shape
 *  ----------------------------- */
const initialStore = {
  // identity (helps when you later sync to backend)
  wallet: "",

  // player picks one
  faction: null, // { id, name, token, logo, initials }

  // weekly/monthly faction scoring (local for now)
  factionPointsWeek: 0,
  factionPointsMonth: 0,

  // soft game stats kept client-side (replace with API later)
  tokensEarned: { CRKS: 0, CRO: 0, CROCARD: 0, MOON: 0, BOBZ: 0, BONE: 0, CRY: 0, KRIS: 0 },
  heists: { played: 0, wins: 0, losses: 0 },

  // stamina lives here (persisted via LS_KEY)
  stamina: 0,
};

/** -----------------------------
 *  Context
 *  ----------------------------- */
const EmpireCtx = createContext({
  state: initialStore,
  setFaction: () => {},
  clearFaction: () => {},
  awardTokens: () => {},
  recordHeist: () => {},
  setStamina: () => {},
  hydrateFromWallet: () => {},
  resetWeek: () => {},
  resetMonth: () => {},
  initStaminaIfNeeded: () => {},
  tickStamina: () => {},
});

/** -----------------------------
 *  Stamina config (matches your ranks JSON)
 *  ----------------------------- */
const STAMINA_TABLE = {
  "Prospect": 0, "Member": 2, "Hustler": 4, "Street Soldier": 6, "Enforcer": 8,
  "Officer": 10, "Captain": 12, "General": 14, "Gang Leader": 16, "Boss": 18,
  "Kingpin": 18, "Overlord": 19, "Icon": 19, "Legend": 20, "Immortal": 20,
};
const REGEN_PER_HOUR = 1;

const staminaMaxFor = (rankName) => STAMINA_TABLE[rankName] ?? 0;

// IMPORTANT: return null if never set (to detect first run)
function getStaminaTs() {
  try {
    const raw = localStorage.getItem(STAM_TS_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function setStaminaTs(ts = Date.now()) {
  try { localStorage.setItem(STAM_TS_KEY, String(ts)); } catch {}
}

/** -----------------------------
 *  Store persistence
 *  ----------------------------- */
function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return initialStore;
    const parsed = JSON.parse(raw);
    // shallow merge to keep forward-compat for new fields
    return { ...initialStore, ...parsed };
  } catch {
    return initialStore;
  }
}
function saveStore(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch {}
}

/** -----------------------------
 *  Provider
 *  ----------------------------- */
export function EmpireProvider({ children }) {
  const [state, setState] = useState(() => loadStore());

  // persist on change
  useEffect(() => { saveStore(state); }, [state]);

  /** --------- Mutators --------- */
  const setFaction = useCallback((f) => {
    setState((prev) => ({ ...prev, faction: f }));
  }, []);

  const clearFaction = useCallback(() => {
    setState((prev) => ({ ...prev, faction: null }));
  }, []);

  // award various tokens; optionally add faction points
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

  // Public setter; spending/adding stamina updates the timestamp so regen resumes from "now".
  const setStamina = useCallback((valueOrUpdater) => {
    setState((prev) => {
      const nextVal = typeof valueOrUpdater === "function"
        ? valueOrUpdater(prev.stamina)
        : valueOrUpdater;
      setStaminaTs(Date.now());
      return { ...prev, stamina: Math.max(0, Math.min(100, Number(nextVal) || 0)) };
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

  /** --------- Stamina helpers (exported) --------- */
  // Initialize only on first run (no timestamp yet) or clamp if cap lowered.
  const initStaminaIfNeeded = useCallback((rankName) => {
    const cap = staminaMaxFor(rankName);
    const lastTs = getStaminaTs();

    setState(prev => {
      const cur = prev.stamina ?? 0;

      // First run ever: no timestamp yet → fill to cap and stamp now
      if (lastTs == null) {
        setStaminaTs(Date.now());
        return { ...prev, stamina: cap };
      }

      // If rank cap decreased, clamp down (never refill on refresh)
      if (cur > cap) {
        return { ...prev, stamina: cap };
      }

      // Otherwise keep current stamina as-is
      return prev;
    });
  }, []);

  // Regenerate +1 per full hour since last tick, up to cap
  const tickStamina = useCallback((rankName) => {
    const cap = staminaMaxFor(rankName);
    if (cap <= 0) return;

    const lastTs = getStaminaTs();
    if (lastTs == null) {
      // If somehow missing, initialize timestamp and bail this tick.
      setStaminaTs(Date.now());
      return;
    }

    const now = Date.now();
    const hours = Math.floor((now - lastTs) / (60 * 60 * 1000));
    if (hours <= 0) return;

    setState(prev => {
      const cur = prev.stamina ?? 0;
      const missing = Math.max(0, cap - cur);
      const gained = Math.min(hours * REGEN_PER_HOUR, missing);

      // advance ts by whole hours (even if already full)
      const newTs = lastTs + hours * 60 * 60 * 1000;
      setStaminaTs(newTs);

      if (gained <= 0) return prev;
      return { ...prev, stamina: Math.min(cap, cur + gained) };
    });
  }, []);

  // Returns UI-friendly regen info (doesn't mutate state)
const getStaminaProgress = useCallback((rankName) => {
  const cap = STAMINA_TABLE[rankName] ?? 0;
  const hourMs = 60 * 60 * 1000;
  const ts = getStaminaTs(); // may be null on first-ever run
  const now = Date.now();

  const stamina = state.stamina ?? 0;
  const isFull = stamina >= cap || cap === 0;

  // If full (or no cap), bar stays full and no countdown
  if (isFull) {
    return {
      cap,
      stamina,
      pctToNext: 1,
      msToNext: 0,
      nextAt: null,
      isFull: true,
    };
  }

  // If we never set a timestamp yet, start the clock now (UI-only)
  const last = ts ?? now;
  const elapsed = now - last;
  const intoThisHour = elapsed % hourMs;
  const pctToNext = Math.min(1, intoThisHour / hourMs);
  const nextAt = last + (Math.floor(elapsed / hourMs) + 1) * hourMs;
  const msToNext = Math.max(0, nextAt - now);

  return {
    cap,
    stamina,
    pctToNext,        // 0..1 progress towards the next +1
    msToNext,         // ms left to the next +1
    nextAt,           // timestamp of the next +1
    isFull: false,
  };
}, [state.stamina]);

  /** --------- Context value --------- */
  const value = useMemo(() => ({
    state,
    setFaction,
    clearFaction,
    awardTokens,
    recordHeist,
    setStamina,
    hydrateFromWallet,
    resetWeek,
    resetMonth,
    initStaminaIfNeeded,
    tickStamina,
    getStaminaProgress,
  }), [
    state,
    setFaction,
    clearFaction,
    awardTokens,
    recordHeist,
    setStamina,
    hydrateFromWallet,
    resetWeek,
    resetMonth,
    initStaminaIfNeeded,
    tickStamina,
    getStaminaProgress,
  ]);

  return <EmpireCtx.Provider value={value}>{children}</EmpireCtx.Provider>;
}

/** -----------------------------
 *  Hook
 *  ----------------------------- */
export function useEmpire() {
  return useContext(EmpireCtx);
}
