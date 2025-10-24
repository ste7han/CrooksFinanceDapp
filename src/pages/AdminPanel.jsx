import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

const API_BASE_RAW = import.meta.env.VITE_API_BASE || "";
const API_BASE = API_BASE_RAW.replace(/\/+$/, "");
const ADMIN_WALLET = (import.meta.env.VITE_DEPLOYER_WALLET || "").toLowerCase();

const TOKENS = ["CRO", "CRKS", "MOON", "KRIS", "BONE", "BOBZ", "CRY", "CROCARD"];

function joinUrl(path) {
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function AdminPanel() {
  const { address } = useWallet();
  const nav = useNavigate();

  // ---- basic guard: redirect if not admin (client-side only; server still enforces) ----
  useEffect(() => {
    const isAdmin = (address || "").toLowerCase() === ADMIN_WALLET;
    if (!isAdmin) nav("/", { replace: true });
  }, [address, nav]);

  // ---- shared headers for admin endpoints ----
  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${ADMIN_WALLET}`,
      "Content-Type": "application/json",
    }),
    []
  );

  async function post(path, body) {
    const r = await fetch(joinUrl(path), {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Request failed");
    return j;
  }
  async function get(path) {
    const r = await fetch(joinUrl(path), { headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "Request failed");
    return j;
  }

  // ---- form state ----
  const [wallet, setWallet] = useState("");
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("");
  const [staminaDelta, setStaminaDelta] = useState("");
  const [busy, setBusy] = useState(false);

  // holdings state
  const [totals, setTotals] = useState(null);
  const [rows, setRows] = useState([]);

  const isValidWallet = /^0x[a-fA-F0-9]{40}$/.test(wallet);
  const pickedToken = token ? token.toUpperCase() : "";
  const isValidToken = !pickedToken || TOKENS.includes(pickedToken);
  const amountNum = Number(amount);
  const staminaNum = Number(staminaDelta);

  // ---- actions ----
  async function handleResetAll() {
    setBusy(true);
    try {
      const body = pickedToken ? { token: pickedToken } : {};
      const j = await post("/api/admin/resetAllBalances", body);
      alert(`✅ Reset OK${j.reset ? ` for ${j.reset}` : ""}`);
    } catch (e) {
      alert(`❌ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetWallet() {
    if (!isValidWallet) return;
    setBusy(true);
    try {
      const body = { wallet, ...(pickedToken ? { token: pickedToken } : {}) };
      await post("/api/admin/resetWalletBalances", body);
      alert("✅ Wallet funds reset");
    } catch (e) {
      alert(`❌ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddFunds() {
    if (!isValidWallet || !TOKENS.includes(pickedToken) || !Number.isFinite(amountNum)) return;
    setBusy(true);
    try {
      const j = await post("/api/admin/addFunds", {
        wallet,
        token: pickedToken,
        amount: amountNum,
      });
      alert(`✅ Added ${amountNum} ${pickedToken} → new balance: ${j.balance}`);
    } catch (e) {
      alert(`❌ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleGrantStamina() {
    if (!isValidWallet || !Number.isFinite(staminaNum)) return;
    setBusy(true);
    try {
      const j = await post("/api/admin/grantStamina", { wallet, delta: staminaNum });
      alert(`✅ Stamina set to ${j.stamina} (cap ${j.cap || 0})`);
    } catch (e) {
      alert(`❌ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleFetchHoldings() {
    setBusy(true);
    try {
      const j = await get("/api/admin/holdingsSummary");
      setTotals(j.totals || {});
      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e) {
      alert(`❌ ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  // ---- UI bits ----
  const inputCls =
    "px-3 py-2 rounded-xl bg-black/30 border border-white/10 outline-none text-sm w-full";
  const btnCls =
    "px-4 py-2 rounded-2xl bg-white/10 hover:bg-white/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed";
  const boxCls = "p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3";

  return (
    <div className="min-h-[calc(100vh-56px)] max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Admin Panel</h1>
        <div className="text-xs opacity-70">
          API: <span className="font-mono">{API_BASE || "(unset VITE_API_BASE)"}</span>
        </div>
      </div>

      {/* RESET ALL */}
      <section className={boxCls}>
        <h2 className="font-semibold">Reset all funds</h2>
        <p className="text-sm opacity-80">
          Zet alle game-wallet balances naar 0. Optioneel: alleen één token.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <TokenSelect token={pickedToken} setToken={setToken} />
          <button
            onClick={handleResetAll}
            disabled={busy || (pickedToken && !isValidToken)}
            className={btnCls}
          >
            Reset
          </button>
        </div>
      </section>

      {/* RESET WALLET */}
      <section className={boxCls}>
        <h2 className="font-semibold">Reset funds for wallet</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value.trim())}
            placeholder="0x…"
            className={inputCls}
          />
          <TokenSelect token={pickedToken} setToken={setToken} allowEmpty />
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleResetWallet}
            disabled={busy || !isValidWallet || (pickedToken && !isValidToken)}
            className={btnCls}
          >
            Reset
          </button>
          {!isValidWallet && wallet && (
            <span className="text-xs text-red-400 self-center">Invalid wallet</span>
          )}
        </div>
      </section>

      {/* ADD FUNDS */}
      <section className={boxCls}>
        <h2 className="font-semibold">Add funds (airdrop)</h2>
        <div className="grid sm:grid-cols-3 gap-2">
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value.trim())}
            placeholder="0x…"
            className={inputCls}
          />
          <TokenSelect token={pickedToken} setToken={setToken} />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className={inputCls}
            inputMode="decimal"
          />
        </div>
        <div>
          <button
            onClick={handleAddFunds}
            disabled={busy || !isValidWallet || !TOKENS.includes(pickedToken) || !Number.isFinite(amountNum)}
            className={btnCls}
          >
            Add
          </button>
        </div>
      </section>

      {/* GRANT STAMINA */}
      <section className={boxCls}>
        <h2 className="font-semibold">Grant stamina</h2>
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value.trim())}
            placeholder="0x…"
            className={inputCls}
          />
          <input
            value={staminaDelta}
            onChange={(e) => setStaminaDelta(e.target.value)}
            placeholder="+N stamina"
            className={inputCls}
            inputMode="numeric"
          />
        </div>
        <div>
          <button
            onClick={handleGrantStamina}
            disabled={busy || !isValidWallet || !Number.isFinite(staminaNum)}
            className={btnCls}
          >
            Grant
          </button>
        </div>
      </section>

      {/* HOLDINGS */}
      <section className={boxCls}>
        <h2 className="font-semibold">Holdings overview</h2>
        <div className="flex items-center gap-2">
          <button onClick={handleFetchHoldings} disabled={busy} className={btnCls}>
            Fetch
          </button>
          {totals && (
            <div className="text-xs opacity-80">
              Totals:&nbsp;
              {Object.entries(totals).map(([sym, val]) => (
                <span key={sym} className="mr-2">
                  <span className="font-mono">{sym}</span>: {Number(val).toLocaleString()}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* table */}
        {rows?.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-white/10">
            <table className="min-w-full text-sm">
              <thead className="bg-black/30">
                <tr className="text-left">
                  <th className="px-3 py-2 border-b border-white/10">Wallet</th>
                  <th className="px-3 py-2 border-b border-white/10">Token</th>
                  <th className="px-3 py-2 border-b border-white/10">Balance</th>
                  <th className="px-3 py-2 border-b border-white/10">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="odd:bg-white/5">
                    <td className="px-3 py-2 font-mono">{r.wallet_address || "—"}</td>
                    <td className="px-3 py-2">{r.token_symbol}</td>
                    <td className="px-3 py-2">{Number(r.balance).toLocaleString()}</td>
                    <td className="px-3 py-2 opacity-70">{new Date(r.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Token dropdown with optional empty value */
function TokenSelect({ token, setToken, allowEmpty = false }) {
  const baseCls = "px-3 py-2 rounded-xl bg-black/30 border border-white/10 outline-none text-sm";
  return (
    <select
      value={token}
      onChange={(e) => setToken(e.target.value)}
      className={baseCls}
    >
      {allowEmpty && <option value="">All tokens</option>}
      {TOKENS.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
