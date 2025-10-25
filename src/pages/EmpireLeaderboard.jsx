import React, { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWallet } from "../context/WalletContext";

// ===== Styling helpers (consistent with other Empire pages) =====
const GLASS = "bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl";
const SOFT = "shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)]";
const BTN = "rounded-2xl px-4 py-2 transition disabled:opacity-50 disabled:cursor-not-allowed";
const BTN_GHOST = `${BTN} bg-white/8 hover:bg-white/14 border border-white/12`;
const BTN_TOGGLE = (active) =>
  `${BTN} ${active ? "bg-emerald-500 text-black hover:bg-emerald-400" : "bg-white/8 hover:bg-white/14 border border-white/12"}`;

// ===== API helpers =====
const BACKEND = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn("[leaderboard] fetch failed:", e);
    return [];
  }
}

// Example endpoints expected (we’ll build backend later):
// /api/leaderboard/strength
// /api/leaderboard/heists?period=week|month|all
// /api/leaderboard/points?period=week|month|all
// /api/leaderboard/factions?period=week|month|all
// /api/leaderboard/payouts

// ===== Reusable helpers =====
const fmt = (n, d = 2) => {
  const x = Number(n);
  if (!isFinite(x)) return "—";
  if (Math.abs(x) >= 1000) return x.toLocaleString(undefined, { maximumFractionDigits: d });
  return x.toFixed(d);
};
const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function EmpireLeaderboard() {
  const { address } = useWallet();
  const [category, setCategory] = useState("strength");
  const [period, setPeriod] = useState("week");
  const [tokenFilter, setTokenFilter] = useState("ALL");     // 🟢 NEW
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const categories = [
    { key: "strength", label: "Top Strength", desc: "Wallets with the highest total weapon power" },
    { key: "heists", label: "Most Heists Won", desc: "Top players by successful heists" },
    { key: "points", label: "Most Points", desc: "Empire points collected" },
    { key: "factions", label: "Top Factions", desc: "Faction-wide dominance" },
    { key: "payouts", label: "Most Payouts", desc: "Highest token earnings overall" },
  ];

  const periods = ["week", "month", "all"];
  const tokenOptions = ["ALL", "CRO", "CRKS", "MOON", "BONE", "BOBZ", "KRIS", "CRY", "CROCARD"];

  useEffect(() => {
    (async () => {
      setLoading(true);
      setRows([]);
      let url = `${BACKEND}/api/leaderboard/${category}`;
      if (category !== "strength" && category !== "payouts") url += `?period=${period}`;
      if (category === "payouts" && tokenFilter && tokenFilter !== "ALL")
        url += `?token=${tokenFilter}`;
      const data = await fetchJson(url);
      setRows(Array.isArray(data) ? data : []);
      setLoading(false);
    })();
  }, [category, period, tokenFilter]);


  // Animated list transitions
  const variants = {
    hidden: { opacity: 0, y: 10 },
    visible: (i) => ({
      opacity: 1,
      y: 0,
      transition: { delay: i * 0.04 },
    }),
  };

  return (
    <div
      className="min-h-screen w-full text-neutral-50 relative bg-animated"
      style={{
        backgroundImage: "url('/pictures/crooks-empire2-bg.png')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.55),rgba(0,0,0,0.85))]" />
      <div className="relative max-w-6xl mx-auto p-6">

        {/* HEADER */}
        <div className={`${GLASS} ${SOFT} p-4 md:p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4`}>
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">Leaderboard</h1>
            <p className="opacity-80 text-sm md:text-base">
              Weekly, monthly, and all-time stats across the Empire.
            </p>
          </div>
        </div>

        {/* CATEGORY TABS */}
        <div className="mt-5 flex flex-wrap gap-2">
          {categories.map((c) => (
            <button
              key={c.key}
              className={BTN_TOGGLE(category === c.key)}
              onClick={() => setCategory(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* PERIOD FILTERS */}
        {!(category === "strength" || category === "payouts") && (
          <div className="mt-3 flex gap-2">
            {periods.map((p) => (
              <button
                key={p}
                className={BTN_TOGGLE(period === p)}
                onClick={() => setPeriod(p)}
              >
                {p === "week" ? "Weekly" : p === "month" ? "Monthly" : "All Time"}
              </button>
            ))}
          </div>
        )}

        {/* LEADERBOARD LIST */}
        <div className={`${GLASS} ${SOFT} mt-6 p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-lg">
              {categories.find((c) => c.key === category)?.label}
            </h2>
            {address && (
              <span className="text-xs opacity-80">
                You: <b>{short(address)}</b>
              </span>
            )}
          </div>

          {loading && <div className="opacity-70 text-sm">Loading data…</div>}

          {category === "payouts" && (
            <div className="mb-4 flex flex-wrap gap-2">
                {tokenOptions.map((t) => (
                <button
                    key={t}
                    className={BTN_TOGGLE(tokenFilter === t)}
                    onClick={() => setTokenFilter(t)}
                >
                    {t}
                </button>
                ))}
            </div>
            )}


          {!loading && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="opacity-70 text-left border-b border-white/10">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Wallet / Faction</th>
                    <th className="px-3 py-2 text-right">
                      {category === "strength"
                        ? "Strength"
                        : category === "heists"
                        ? "Heists Won"
                        : category === "points"
                        ? "Points"
                        : category === "factions"
                        ? "Total Points"
                        : "Total Payout"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {rows.map((r, i) => (
                      <motion.tr
                        key={`${r.wallet || r.faction}-${i}`}
                        custom={i}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        variants={variants}
                        className={`border-b border-white/10 ${i % 2 ? "bg-white/5" : ""}`}
                      >
                        <td className="px-3 py-2 text-emerald-300 font-mono">{r.rank || i + 1}</td>
                        <td className="px-3 py-2 font-mono truncate">
                          {r.wallet ? short(r.wallet) : r.faction || "—"}
                          {r.token && (
                            <span className="ml-2 text-xs opacity-70">{r.token}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">
                          {fmt(r.value, 0)}
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* SHARE BLOCK */}
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              alert("🖼️ Tip: You can use your OS screenshot tool to share this leaderboard on X.");
            }}
            className={BTN_GHOST}
          >
            Share on X 🖤
          </button>
        </div>

        <footer className="mt-10 text-center text-xs opacity-60">
          <p>Leaderboard auto-refreshes weekly. Powered by Crooks Empire 🦹‍♂️</p>
        </footer>
      </div>
    </div>
  );
}
