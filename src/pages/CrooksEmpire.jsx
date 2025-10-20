// src/pages/CrooksEmpire.jsx
import { Link } from "react-router-dom";

const TILES = [
  { label: "Profile", to: "/empire/profile", img: "/pictures/Profile_banner.png", title: "Open Profile" },
  { label: "Bank",    to: "/empire/bank",    img: "/pictures/Bank_banner.png",    title: "Open Bank" },
  { label: "Armory",  to: "/empire/armory",  img: "/pictures/Armory_banner.png",  title: "Open Armory" },
  { label: "Heists",  to: "/empire/heists",  img: "/pictures/Heists_banner.png",  title: "Open Heists" },
  { label: "Casino",  to: "/empire/casino",  img: "/pictures/Casino_banner.png",  title: "Open Casino" },
];

export default function CrooksEmpire() {
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
      {/* Donkere overlay voor leesbaarheid */}
      <div className="absolute inset-0 bg-[radial-gradient(900px_500px_at_70%_-10%,rgba(16,185,129,0.30),transparent_70%),linear-gradient(to_bottom,rgba(0,0,0,0.55),rgba(0,0,0,0.85))]" />

      {/* Pagina-inhoud */}
      <div className="relative max-w-6xl mx-auto p-6">
        <h1 className="text-3xl md:text-4xl font-bold">Crooks Empire</h1>
        <p className="mt-2 opacity-80">Choose a module to open.</p>

        {/* Grid met tiles */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {TILES.map(({ label, to, img, title }) => (
            <Link
              key={label}
              to={to}
              className="group relative aspect-square rounded-2xl overflow-hidden border border-white/10 bg-white/5
                         hover:bg-white/10 transition shadow-[0_10px_40px_-10px_rgba(0,0,0,0.5)] focus:outline-none focus:ring-2 focus:ring-emerald-400/60"
              title={title}
            >
              {/* Background image */}
              <img
                src={img}
                alt={label}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
              />
              {/* Gradient overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent
                              opacity-80 group-hover:opacity-90 transition" />
              {/* Label */}
              <div className="absolute bottom-0 left-0 right-0 p-4 flex items-center justify-between">
                <span className="text-lg font-semibold">{label}</span>
                <span className="text-sm opacity-80 group-hover:opacity-100 transition">Enter →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
