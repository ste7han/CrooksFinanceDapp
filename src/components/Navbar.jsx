import { NavLink } from "react-router-dom";
import { useWallet } from "../context/WalletContext";

export default function Navbar() {
  const { address, connect } = useWallet();

  const links = [
    { to: "/", label: "Crooks Finance" },
    { to: "/legends", label: "Crooks Legends" },
    { to: "/empire", label: "Crooks Empire" },
  ];

  const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-md border-b border-white/10">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="text-lg font-bold tracking-wide text-emerald-400">
          CROOKS
        </div>

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

        <div>
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
