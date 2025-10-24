import { NavLink, Link } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

export default function Navbar() {
  const { address, connect } = useWallet();

  // Frontend env var (same wallet as ADMIN_WALLET in Cloudflare)
  const ADMIN = (import.meta.env.VITE_DEPLOYER_WALLET || "").toLowerCase();
  const isAdmin = (address || "").toLowerCase() === ADMIN;

  const links = [
    { to: "/", label: "Crooks Finance" },
    { to: "/legends", label: "Crooks Legends" },
    { to: "/empire", label: "Crooks Empire" },
  ];

  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-md border-b border-white/10">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <div className="text-lg font-bold tracking-wide text-emerald-400">
          CROOKS
        </div>

        {/* Main links */}
        <div className="flex items-center gap-6">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `text-sm transition-colors ${
                  isActive
                    ? "text-emerald-400 font-semibold"
                    : "text-gray-200 hover:text-emerald-300"
                }`
              }
              end={l.to === "/"}
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        {/* Wallet + Admin Gear */}
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Link
              to="/admin"
              className="p-2 rounded-xl hover:bg-white/10 text-gray-300 hover:text-emerald-400 transition"
              title="Admin Panel"
            >
              {/* simple inline gear icon */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="w-5 h-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.4 15a7.96 7.96 0 0 0 .1-1 7.96 7.96 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.4a.5.5 0 0 0-.6-.2l-2.5 1a8.1 8.1 0 0 0-1.7-1l-.4-2.7a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4L8.6 5a8.1 8.1 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.4a.5.5 0 0 0 .1.6L3.9 13a7.96 7.96 0 0 0-.1 1 7.96 7.96 0 0 0 .1 1l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.4a.5.5 0 0 0 .6.2l2.5-1a8.1 8.1 0 0 0 1.7 1l.4 2.7a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.7a8.1 8.1 0 0 0 1.7-1l2.5 1a.5.5 0 0 0 .6-.2l2-3.4a.5.5 0 0 0-.1-.6L19.4 15Z"
                />
              </svg>
            </Link>
          )}

          <button
            onClick={connect}
            className="rounded-xl px-4 py-2 bg-neutral-900/70 text-white border border-white/10 hover:bg-neutral-900/50 transition text-sm"
          >
            {address ? short(address) : "Connect Wallet"}
          </button>
        </div>
      </div>
    </nav>
  );
}
