import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { useEmpire } from "../context/EmpireContext";

const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const SOFT = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const BTN = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_GHOST = `${BTN} bg-white/8 hover:bg-white/14 border border-white/12`;
const BTN_PRIMARY = `${BTN} bg-emerald-500 text-black hover:bg-emerald-400`;
const INPUT = "bg-white/5 border border-white/10 rounded-xl px-3 py-2 w-full outline-none focus:border-emerald-400/60";
const BTN_SM = "px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed";



const TOKENS = [
  { sym: "CRO",     label: "Cronos",         icon: "/pictures/factions/cro.png",     decimals: 18 },
  { sym: "CRKS",    label: "Crooks",         icon: "/pictures/factions/crooks.png",    decimals: 18 },
  { sym: "MOON",    label: "Wolfswap MOON",  icon: "/pictures/factions/wolfswap.png",    decimals: 18 },
  { sym: "KRIS",    label: "Kris",           icon: "/pictures/factions/kristoken.png",    decimals: 18 },
  { sym: "BONE",    label: "Crohounds BONE", icon: "/pictures/factions/crohounds.png",    decimals: 18 },
  { sym: "BOBZ",    label: "BobsAdventures", icon: "/pictures/factions/bobsadventures.png",    decimals: 18 },
  { sym: "CRY",     label: "Crazzzy Monster",icon: "/pictures/factions/crazzzymonsters.png",     decimals: 18 },
  { sym: "CROCARD", label: "Cards of Cronos",icon: "/pictures/factions/cardsofcronos.png", decimals: 18 },
];

// localStorage key to queue withdrawal requests until backend is wired
const LS_WITHDRAWALS = "crooks:bank:withdrawals";

function loadQueuedWithdrawals() {
  try { return JSON.parse(localStorage.getItem(LS_WITHDRAWALS) || "[]"); } catch { return []; }
}
function saveQueuedWithdrawals(list) {
  try { localStorage.setItem(LS_WITHDRAWALS, JSON.stringify(list)); } catch {}
}

export default function Bank() {
  const { address, networkOk } = useWallet();
  const { state: empire } = useEmpire();

  // Derived “game wallet” balances — prefer empire.tokensEarned if present
  const balances = useMemo(() => {
    const src = empire?.tokensEarned || {};
    const map = {};
    TOKENS.forEach(t => { map[t.sym] = Number(src[t.sym] ?? 0); });
    return map;
  }, [empire]);

  const [withdrawals, setWithdrawals] = useState(loadQueuedWithdrawals());

  // Withdraw modal state
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    token: "CRKS",
    amount: "",
    to: "",
    note: "",
  });
  useEffect(() => {
    // default recipient = connected wallet
    setForm(prev => ({ ...prev, to: address || "" }));
  }, [address]);

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

    // If you want to block over-withdraw for UX now:
    const bal = balances[form.token] ?? 0;
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

    // 🔁 For now: queue locally; later: POST to backend instead
    const next = [req, ...withdrawals].slice(0, 200);
    setWithdrawals(next);
    saveQueuedWithdrawals(next);
    setShowModal(false);

    // TODO (backend): replace the above with an API call like:
    // await fetch(`${import.meta.env.VITE_API_BASE}/bank/withdraw`, {
    //   method: "POST",
    //   headers: {"Content-Type":"application/json", "x-api-key": import.meta.env.VITE_API_KEY},
    //   body: JSON.stringify(req)
    // });
    // then refresh from GET /bank/withdrawals
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
              View your in-game balances and request withdrawals.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!networkOk && (
              <span className="text-xs bg-red-500/20 border border-red-400/40 rounded-xl px-2 py-1">
                Not on Cronos (25)
              </span>
            )}
            <Link to="/empire/profile" className={BTN_GHOST}>Back to Profile</Link>
          </div>
        </header>

        {/* Wallet + address */}
        <section className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`${GLASS} ${SOFT} p-5 lg:col-span-2`}>
            <h3 className="font-semibold text-lg">Balances (Game Wallet)</h3>
            <p className="text-xs opacity-70 mt-1">
              These are your off-chain balances tracked by Crooks Empire. You can request a withdrawal to your wallet.
            </p>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {TOKENS.map(t => {
                const bal = Number(balances[t.sym] ?? 0);
                return (
                    <div
                    key={t.sym}
                    className="flex items-center justify-between border border-white/10 rounded-2xl p-4 bg-white/5 hover:bg-white/10 transition"
                    >
                    {/* LEFT SIDE: icon + token symbol */}
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl overflow-hidden bg-white/10 border border-white/10 shrink-0">
                        <img src={t.icon} alt={t.sym} className="w-full h-full object-cover" />
                        </div>
                        <div className="flex flex-col">
                        <span className="font-semibold text-lg">{t.sym}</span>
                        <span className="text-xs opacity-60">{bal.toLocaleString()}</span>
                        </div>
                    </div>

                    {/* RIGHT SIDE: Withdraw button */}
                    <button
                        className="px-3 py-1.5 text-xs rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 disabled:opacity-40 disabled:cursor-not-allowed"
                        onClick={() => openWithdraw(t.sym)}
                        disabled={bal <= 0}
                        title={bal <= 0 ? `No ${t.sym} to withdraw` : `Withdraw ${t.sym}`}
                    >
                        Withdraw
                    </button>
                    </div>
                );
                })}
            </div>
          </div>

          <div className={`${GLASS} ${SOFT} p-5`}>
            <h3 className="font-semibold text-lg">Your Wallet</h3>
            <div className="mt-2 text-sm break-all">
              <span className="opacity-70">Connected:</span><br/>
              {address ? <code>{address}</code> : <span className="opacity-70">Not connected</span>}
            </div>
            <div className="mt-3 text-xs opacity-70">
              Tip: withdrawals go to your connected wallet by default—you can change the destination in the request form.
            </div>
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
              For now, requests are stored locally. Next step: wire this to your backend so staff can review/pay them.
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
                  placeholder={`Max: ${formatInt(balances[form.token] ?? 0)}`}
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                />
                <div className="mt-1 text-xs opacity-60">
                  Balance: {formatInt(balances[form.token] ?? 0)} {form.token}
                  {" "}
                  <button
                    type="button"
                    className="underline hover:opacity-100"
                    onClick={() => setForm(f => ({ ...f, amount: String(balances[f.token] ?? 0) }))}
                  >Max</button>
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

function shortAddr(a) {
  if (!a) return "";
  return a.slice(0, 6) + "…" + a.slice(-4);
}
function formatInt(n) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString();
}
