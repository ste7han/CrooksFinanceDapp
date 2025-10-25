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
// Normalize API base so we never end up with /api/api/...
const RAW_API_BASE =
  (import.meta.env.VITE_PAGES_API ||
   import.meta.env.VITE_API_BASE ||
   import.meta.env.VITE_BACKEND_URL ||
   "").trim();
const API_BASE = RAW_API_BASE
  .replace(/\/+$/, "")       // strip trailing slashes
  .replace(/\/api$/, "");    // strip trailing /api if present

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

// ---------- Component ----------
export default function Bank() {
  const { address, networkOk } = useWallet();
  const { refreshStamina, state: empire } = useEmpire();

  // Balances map {SYM: number} — always show all tokens (incl. zeros)
  const [balances, setBalances] = useState(() =>
    Object.fromEntries(TOKENS.map(t => [t.sym, 0]))
  );

  // Analytics (from first version)
  const [totals, setTotals] = useState({}); // {SYM: number withdrawn}
  const [recent, setRecent] = useState([]); // last 10 rows

  // Misc UI state
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ token: "CRKS", amount: "", to: "", note: "" });

  // Default recipient = connected wallet
  useEffect(() => {
    setForm(prev => ({ ...prev, to: address || "" }));
  }, [address]);

  // ----- Balance loader (logic proven in your “working” version) -----
  const fetchBalances = async () => {
    if (!address) return;
    try {
      setLoading(true);
      setErr("");

      // Ensure user exists (best-effort)
      await fetch(`${API_BASE}/api/me`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: address }),
      }).catch(() => {});

      const res = await fetch(`${API_BASE}/api/me/balances`, {
        headers: { "X-Wallet-Address": address },
        cache: "no-store",
      });

      // Build a full map for our canonical token list
      const map = Object.fromEntries(TOKENS.map(t => [t.sym, 0]));
      const j = await res.json().catch(() => ({}));

      // Accept both {balances:[...]} and raw array []
      const rows = Array.isArray(j?.balances) ? j.balances : (Array.isArray(j) ? j : []);
      for (const row of rows) {
        const sym = String(row?.token_symbol || row?.symbol || row?.token || "").toUpperCase();
        const num = Number(row?.balance ?? row?.amount ?? 0);
        if (sym in map) map[sym] = Number.isFinite(num) ? num : 0;
      }

      setBalances(map);
    } catch (e) {
      setErr(e?.message || "Failed to load balances");
      // Keep previous balances; page still renders the cards
    } finally {
      setLoading(false);
    }
  };

  // ----- Analytics (kept from first version) -----
  const fetchAnalytics = async () => {
    if (!address) { setTotals({}); setRecent([]); return; }
    try {
      const r = await fetch(
        `${API_BASE}/api/me/withdrawals?wallet=${encodeURIComponent(address)}`,
        { headers: { "X-Wallet-Address": address }, cache: "no-store" }
      );
      const j = await r.json().catch(() => ({}));
      setTotals(j?.totals || {});
      setRecent(j?.recent || []);
    } catch {
      setTotals({}); setRecent([]);
    }
  };

  useEffect(() => {
    if (address) {
      fetchBalances();
      fetchAnalytics();
    }
  }, [address]);

  function openWithdraw(sym) {
    setForm({ token: sym, amount: "", to: address || "", note: "" });
    setShowModal(true);
  }
  function closeModal() { setShowModal(false); }

  async function submitWithdrawal(e) {
    e?.preventDefault?.();
    const amt = Number(form.amount);
    if (!form.token) return;
    if (!Number.isFinite(amt) || amt <= 0) return alert("Enter a valid amount.");
    if (!/^0x[a-fA-F0-9]{40}$/.test(form.to || "")) return alert("Enter a valid wallet address (0x...).");

    const bal = Number(balances[form.token] ?? 0);
    if (amt > bal) return alert(`Amount exceeds your ${form.token} balance (${bal}).`);

    setBusy(true);
    try {
      const r = await fetch(`${API_BASE}/api/withdraw`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Wallet-Address": address,
        },
        body: JSON.stringify({ token: form.token, amount: amt, to: form.to, note: form.note }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `Withdraw failed (${r.status})`);

      await fetchBalances();
      await fetchAnalytics();
      await refreshStamina().catch(() => {});

      alert(`Sent ${amt} ${form.token}\n${j.tx_hash ? `Tx: ${j.tx_hash}` : "Tx pending"}`);
      setShowModal(false);
    } catch (e) {
      alert(e?.message || "Withdraw failed");
    } finally {
      setBusy(false);
    }
  }

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
              Your in-game balances & withdrawals.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {!networkOk && (
              <span className="text-xs bg-red-500/20 border border-red-400/40 rounded-xl px-2 py-1">
                Not on Cronos (25)
              </span>
            )}
            <Link to="/empire/profile" className={BTN_GHOST}>Profile</Link>
            <Link to="/empire/heists" className={BTN_GHOST}>Heists</Link>
            <Link to="/empire/armory" className={BTN_GHOST}>Armory</Link>
            <Link to="/empire/casino" className={BTN_GHOST}>Casino</Link>
            {address && (
              <button
                className={BTN_GHOST}
                onClick={() => { fetchBalances(); fetchAnalytics(); }}
                disabled={loading}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </div>
        </header>

        {/* Balances (always show full list incl. zeros) */}
        <section className="mt-5">
          <div className={`${GLASS} ${SOFT} p-5`}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Holdings</h3>
              <div className="text-[11px] opacity-70">API: <code>{API_BASE || "(same-origin)"}</code></div>
            </div>

            {loading && <div className="mt-4 text-sm opacity-70">Loading…</div>}
            {err && <div className="mt-4 text-sm text-rose-400">{err}</div>}

            {!loading && !err && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {TOKENS.map(t => {
                  const val = Number(balances[t.sym] ?? 0);
                  return (
                    <div
                      key={t.sym}
                      className="flex items-center justify-between border border-white/10 rounded-2xl p-4 bg-white/5 hover:bg-white/10 transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/10 border border-white/10 shrink-0">
                          <img src={t.icon} alt={t.sym} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex flex-col">
                          <span className="font-semibold text-lg">{t.sym}</span>
                          <span className="text-xs opacity-60">{val.toLocaleString()}</span>
                        </div>
                      </div>
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
        </section>

        {/* Analytics */}
        <section className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className={`${GLASS} ${SOFT} p-5`}>
            <h3 className="font-semibold text-lg">Withdrawn Totals</h3>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {TOKENS.map(t => (
                <div key={t.sym} className="bg-white/5 rounded-xl p-3 border border-white/10">
                  <div className="text-xs opacity-70">{t.sym}</div>
                  <div className="text-xl font-bold mt-1">
                    {Number(totals[t.sym] || 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className={`${GLASS} ${SOFT} p-5`}>
            <h3 className="font-semibold text-lg">Recent Withdrawals</h3>
            {recent?.length ? (
              <div className="mt-3 space-y-2 max-h-72 overflow-auto pr-1">
                {recent.map((r, i) => (
                  <div key={i} className="flex items-center justify-between border border-white/10 rounded-xl p-2 bg-white/5">
                    <div className="text-sm">
                      <b>{r.token_symbol}</b> {Number(r.amount).toLocaleString()}
                      <div className="text-[11px] opacity-70">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                      </div>
                    </div>
                    <span className="text-xs opacity-80">{r.status || "paid"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-sm opacity-70">No withdrawals yet.</div>
            )}
          </div>
        </section>
      </div>

      {/* Withdraw Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className={`${GLASS} ${SOFT} relative w-full max-w-lg p-5`}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Withdraw</h3>
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
                  step="any"
                  placeholder={`Max: ${Number(balances[form.token] ?? 0).toLocaleString()}`}
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
                <div className="mt-1 text-xs opacity-60">
                  Balance: {Number(balances[form.token] ?? 0).toLocaleString()} {form.token}{" "}
                  <button
                    type="button"
                    className="underline hover:opacity-100"
                    onClick={() => setForm(f => ({ ...f, amount: String(balances[f.token] ?? 0) }))}
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
                <div className="text-[11px] opacity-60 mt-1">Defaults to your connected wallet.</div>
              </div>
              <div className="pt-2 flex items-center justify-end gap-2">
                <button type="button" className={BTN_GHOST} onClick={closeModal}>Cancel</button>
                <button type="submit" className={BTN_PRIMARY} disabled={busy}>
                  {busy ? "Sending…" : "Withdraw"}
                </button>
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
