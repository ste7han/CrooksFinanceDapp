// src/pages/EmpireBank.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useEmpire } from "../context/EmpireContext";

// ---------- UI helpers ----------
const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const SOFT = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const BTN = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_GHOST = `${BTN} bg-white/8 hover:bg-white/14 border border-white/12`;
const BTN_PRIMARY = `${BTN} bg-emerald-500 text-black hover:bg-emerald-400`;
const INPUT = "bg-white/5 border border-white/10 rounded-xl px-3 py-2 w-full outline-none focus:border-emerald-400/60";

// ---------- Constants ----------
const API_BASE =
  import.meta.env.VITE_BACKEND_URL ||
  "https://crooks-backend.steph-danser.workers.dev";

const TOKENS = [
  { sym: "CRO",     label: "Cronos",            icon: "/pictures/factions/cro.png",               decimals: 18 },
  { sym: "CRKS",    label: "Crooks",            icon: "/pictures/factions/crooks.png",            decimals: 18 },
  { sym: "MOON",    label: "Wolfswap MOON",     icon: "/pictures/factions/wolfswap.png",          decimals: 18 },
  { sym: "KRIS",    label: "Kris",              icon: "/pictures/factions/kristoken.png",         decimals: 18 },
  { sym: "BONE",    label: "Crohounds BONE",    icon: "/pictures/factions/crohounds.png",         decimals: 18 },
  { sym: "BOBZ",    label: "BobsAdventures",    icon: "/pictures/factions/bobsadventures.png",    decimals: 18 },
  { sym: "CRY",     label: "Crazzzy Monster",   icon: "/pictures/factions/crazzzymonsters.png",   decimals: 18 },
  { sym: "CROCARD", label: "Cards of Cronos",   icon: "/pictures/factions/cardsofcronos.png",     decimals: 18 },
];

// Local queue (until withdrawals are wired to backend)
const LS_WITHDRAWALS = "crooks:bank:withdrawals";
function loadQueuedWithdrawals() {
  try { return JSON.parse(localStorage.getItem(LS_WITHDRAWALS) || "[]"); } catch { return []; }
}
function saveQueuedWithdrawals(list) {
  try { localStorage.setItem(LS_WITHDRAWALS, JSON.stringify(list)); } catch {}
}

// ---------- Component ----------
export default function Bank() {
  const { address, networkOk } = useWallet();
  const { state: empire } = useEmpire();

  // Backend state
  const [backendBalances, setBackendBalances] = useState([]); // array: [{ token_symbol, balance, updated_at }]
  const [history, setHistory] = useState([]); // optional if your backend returns it
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");

  // Local withdrawals
  const [withdrawals, setWithdrawals] = useState(loadQueuedWithdrawals());

  // Withdraw modal state
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ token: "CRKS", amount: "", to: "", note: "" });

  // Default recipient = connected wallet
  useEffect(() => {
    setForm(prev => ({ ...prev, to: address || "" }));
  }, [address]);

  // Map backend balances -> dict {SYM: number}
  const backendMap = useMemo(() => {
    const map = {};
    for (const row of backendBalances || []) {
      const sym = String(row?.token_symbol || "").toUpperCase();
      const num = Number(row?.balance || 0);
      if (sym) map[sym] = Number.isFinite(num) ? num : 0;
    }
    return map;
  }, [backendBalances]);

  // Local (legacy) game wallet balances
  const localMap = useMemo(() => {
    const src = empire?.tokensEarned || {};
    const map = {};
    TOKENS.forEach(t => { map[t.sym] = Number(src[t.sym] ?? 0); });
    return map;
  }, [empire]);

  // Prefer backend balances; fall back to local
  const displayBalances = useMemo(() => {
    const out = {};
    TOKENS.forEach(t => {
      out[t.sym] = backendMap[t.sym] ?? localMap[t.sym] ?? 0;
    });
    return out;
  }, [backendMap, localMap]);

  // Ensure user exists + fetch balances
  const fetchBackendBalances = async () => {
    if (!address) return;
    try {
      setLoading(true);
      setErr("");

      // 1) Upsert user
      await fetch(`${API_BASE}/api/me`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      });

      // 2) Get balances
      const res = await fetch(`${API_BASE}/api/me/balances`, {
        headers: { "X-Wallet-Address": address },
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load balances");
      setBackendBalances(Array.isArray(j?.balances) ? j.balances : []);
      setHistory(Array.isArray(j?.history) ? j.history : []);
    } catch (e) {
      console.error("[bank] balances error", e);
      setErr(e?.message || "Could not connect to backend");
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch when a wallet connects
  useEffect(() => {
    if (address) fetchBackendBalances();
  }, [address]); // eslint-disable-line

  // UI handlers
  function openWithdraw(sym) {
    setForm({ token: sym, amount: "", to: address || "", note: "" });
    setShowModal(true);
  }
  function closeModal() {
    setShowModal(false);
  }

  function submitWithdrawal(e) {
    e?.preventDefault?.();
    const amt = Number(form.amount);
    if (!form.token) return;
    if (!Number.isFinite(amt) || amt <= 0) return alert("Enter a valid amount.");
    if (!form.to || form.to.length < 10) return alert("Enter a valid wallet address.");

    // Guard UX: block over-withdraw based on what we display to the user
    const bal = Number(displayBalances[form.token] ?? 0);
    if (amt > bal) return alert(`Amount exceeds your ${form.token} balance (${bal}).`);

    const req = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      createdAt: Date.now(),
      wallet: address || "",
      token: form.token,
      amount: amt,
      to: form.to.trim(),
      note: form.note?.trim() || "",
      status: "queued", // queued -> processing -> paid/declined
    };

    // For now, store locally; later: POST to backend
    const next = [req, ...withdrawals].slice(0, 200);
    setWithdrawals(next);
    saveQueuedWithdrawals(next);
    setShowModal(false);
  }

  const clearLocalGameCache = () => {
    try {
      localStorage.removeItem("crooks.empire.state");
      localStorage.removeItem("crooks.empire.week");
      localStorage.removeItem("crooks.empire.month");
      setStatus("🧹 Cleared local game cache");
      setTimeout(() => setStatus(""), 2500);
    } catch {}
  };

  return (
    <div
      className="min-h-screen w-full text-neutral-50 relative"
      style={{
        backgroundImage: "url('/pictures/crooks-empire2-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.55),rgba(0,0,0,0.85))]" />

      <div className="relative max-w-6xl mx-auto p-6">
        <header className={`${GLASS} ${SOFT} p-4 md:p-5 flex items-center justify-between gap-4`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Bank</h1>
            <p className="opacity-80 text-sm md:text-base">
              Live balances from backend (fallback to your local game wallet). Request withdrawals anytime.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!networkOk && (
              <span className="text-xs bg-red-500/20 border border-red-400/40 rounded-xl px-2 py-1">
                Not on Cronos (25)
              </span>
            )}
            <Link to="/empire/profile" className={BTN_GHOST}>Back to Profile</Link>
            {address && (
              <button className={BTN_GHOST} onClick={fetchBackendBalances} disabled={loading}>
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </div>
        </header>

        {/* Wallet + address */}
        <section className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Balances */}
          <div className={`${GLASS} ${SOFT} p-5 lg:col-span-2`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Balances</h3>
              <div className="text-[11px] opacity-70">API: <code>{API_BASE}</code></div>
            </div>
            <p className="text-xs opacity-70 mt-1">
              Backend is authoritative when available. Local values shown only if backend has no entry yet.
            </p>

            {loading && <div className="mt-4 text-sm opacity-70">Loading…</div>}
            {err && <div className="mt-4 text-sm text-rose-400">{err}</div>}

            {!loading && !err && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {TOKENS.map(t => {
                  const backendVal = backendMap[t.sym];
                  const localVal = localMap[t.sym];
                  const val = displayBalances[t.sym] ?? 0;
                  const source = backendVal !== undefined ? "backend" : "local";
                  return (
                    <div
                      key={t.sym}
                      className="flex items-center justify-between border border-white/10 rounded-2xl p-4 bg-white/5 hover:bg-white/10 transition"
                    >
                      {/* LEFT: icon + token */}
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/10 border border-white/10 shrink-0">
                          <img src={t.icon} alt={t.sym} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-lg">{t.sym}</span>
                          <span className="text-xs opacity-60">{val.toLocaleString()}</span>
                          <span className="text-[10px] opacity-50">src: {source}</span>
                        </div>
                      </div>
                      {/* RIGHT: Withdraw */}
                      <button
                        className="px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => openWithdraw(t.sym)}
                        disabled={val <= 0 || !address}
                        title={val <= 0 ? `No ${t.sym} to withdraw` : `Withdraw ${t.sym}`}
                      >
                        Withdraw
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Wallet card */}
          <div className={`${GLASS} ${SOFT} p-5`}>
            <h3 className="font-semibold text-lg">Your Wallet</h3>
            <div className="mt-2 text-sm break-all">
              <span className="opacity-70">Connected:</span><br/>
              {address ? <code>{address}</code> : <span className="opacity-70">Not connected</span>}
            </div>
            <div className="mt-3 text-xs opacity-70">
              Withdrawals default to your connected wallet — you can override the destination.
            </div>

            {/* Utilities (local only) */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button className={BTN_GHOST} onClick={clearLocalGameCache}>
                Clear local game cache
              </button>
              <button className={BTN_GHOST} onClick={() => setWithdrawals(loadQueuedWithdrawals())}>
                Reload requests
              </button>
            </div>
            {status && <div className="mt-3 text-sm text-emerald-400">{status}</div>}
          </div>
        </section>

        {/* Withdrawal queue */}
        <section className="mt-5">
          <div className={`${GLASS} ${SOFT} p-5`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Your Withdrawal Requests</h3>
              <button className={BTN_GHOST} onClick={() => setWithdrawals(loadQueuedWithdrawals())}>
                Refresh
              </button>
            </div>
            {withdrawals.length === 0 ? (
              <div className="mt-4 text-sm opacity-70">No requests yet.</div>
            ) : (
              <div className="mt-3 space-y-2">
                {withdrawals.map(w => (
                  <div key={w.id} className="flex items-center gap-3 border border-white/10 rounded-2xl p-3 bg-white/5">
                    <div className="w-10 text-center font-mono opacity-70">{w.token}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm">
                        <b>{w.amount}</b> {w.token} → <span className="opacity-90">{shortAddr(w.to)}</span>
                      </div>
                      <div className="text-xs opacity-60">
                        {new Date(w.createdAt).toLocaleString()} • {w.status}
                        {w.note ? <> • {w.note}</> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-xs opacity-70">
              Right now requests are local-only. Next step: POST to your backend and list paid/declined status from staff.
            </div>
          </div>
        </section>
      </div>

      {/* Withdraw Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className={`${GLASS} ${SOFT} relative w-full max-w-lg p-5`}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Request Withdrawal</h3>
              <button className={BTN_GHOST} onClick={closeModal}>Close</button>
            </div>
            <form className="mt-4 space-y-3" onSubmit={submitWithdrawal}>
              <div>
                <label className="text-xs opacity-70">Token</label>
                <select
                  className={INPUT}
                  value={form.token}
                  onChange={e => setForm(f => ({ ...f, token: e.target.value }))}
                >
                  {TOKENS.map(t => (
                    <option key={t.sym} value={t.sym}>{t.sym}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs opacity-70">Amount</label>
                <input
                  className={INPUT}
                  type="number"
                  min="0"
                  step="1"
                  placeholder={`Max: ${formatInt(displayBalances[form.token] ?? 0)}`}
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
                <div className="mt-1 text-xs opacity-60">
                  Balance: {formatInt(displayBalances[form.token] ?? 0)} {form.token}{" "}
                  <button
                    type="button"
                    className="underline hover:opacity-100"
                    onClick={() =>
                      setForm(f => ({ ...f, amount: String(displayBalances[f.token] ?? 0) }))
                    }
                  >
                    Max
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs opacity-70">Send to (wallet)</label>
                <input
                  className={INPUT}
                  type="text"
                  placeholder="0x..."
                  value={form.to}
                  onChange={e => setForm(f => ({ ...f, to: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs opacity-70">Note (optional)</label>
                <input
                  className={INPUT}
                  type="text"
                  placeholder="Anything staff should know"
                  value={form.note}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                />
              </div>
              <div className="pt-2 flex items-center justify-end gap-2">
                <button type="button" className={BTN_GHOST} onClick={closeModal}>Cancel</button>
                <button type="submit" className={BTN_PRIMARY}>Submit request</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- helpers ----------
function shortAddr(a) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}
function formatInt(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString();
}
