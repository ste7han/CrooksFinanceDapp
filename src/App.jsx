import { BrowserRouter, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import CrooksFinance from "./pages/CrooksFinance";
import CrooksEmpire from "./pages/CrooksEmpire";
import EmpireArmory from "./pages/EmpireArmory";
import CrooksLegends from "./pages/CrooksLegends";
import EmpireProfile from "./pages/EmpireProfile";
import EmpireBank from "./pages/EmpireBank.jsx";
import EmpireHeists from "./pages/EmpireHeists.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";
import { WalletProvider } from "./context/WalletContext";
import { EmpireProvider } from "./context/EmpireContext";   // ✅ import this

// tijdelijk debuggen – mag je later verwijderen
console.log("ENV DEBUG:", {
  RPC: import.meta.env.VITE_RPC_URL,
  MORALIS: import.meta.env.VITE_MORALIS_KEY ? "(key aanwezig)" : "❌ geen key",
  IMAGE_BASE: import.meta.env.VITE_NFT_IMAGE_BASE,
  FEED: import.meta.env.VITE_EBISUS_FEED_URL,
});

export default function App() {
  return (
    <WalletProvider>
      <EmpireProvider> {/* ✅ add this wrapper */}
        <BrowserRouter>
          <Navbar />
          <div className="pt-16">
            <Routes>
              <Route path="/" element={<CrooksFinance />} />
              <Route path="/legends" element={<CrooksLegends />} />
              <Route path="/empire" element={<CrooksEmpire />} />
              <Route path="/empire/armory" element={<EmpireArmory />} />
              <Route path="/empire/profile" element={<EmpireProfile />} />
              <Route path="/empire/bank" element={<EmpireBank />} />
              <Route path="/empire/heists" element={<EmpireHeists />} />
              <Route path="/admin" element={<AdminPanel />} />
              <Route path="/empire/casino" element={<div />} />
            </Routes>
          </div>
        </BrowserRouter>
      </EmpireProvider>
    </WalletProvider>
  );
}
