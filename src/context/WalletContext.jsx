import React, { createContext, useContext, useEffect, useState } from "react";
import { ethers } from "ethers";

const WalletContext = createContext();

export function WalletProvider({ children }) {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState("");
  const [networkOk, setNetworkOk] = useState(false);

  const CRONOS_PARAMS = {
    chainId: "0x19",
    chainName: "Cronos Mainnet",
    nativeCurrency: { name: "CRO", symbol: "CRO", decimals: 18 },
    rpcUrls: ["https://evm.cronos.org"],
    blockExplorerUrls: ["https://cronoscan.com"],
  };

  useEffect(() => {
    if (!window.ethereum) return;
    const p = new ethers.BrowserProvider(window.ethereum);
    setProvider(p);

    const sync = async () => {
      try {
        const net = await p.getNetwork();
        setNetworkOk(Number(net.chainId) === 25);
      } catch {}
    };
    sync();

    const onChainChanged = () => sync();
    const onAccountsChanged = async (accs) => {
      setAddress(accs?.[0] || "");
      setSigner(accs?.[0] ? await p.getSigner() : null);
    };

    window.ethereum.on?.("chainChanged", onChainChanged);
    window.ethereum.on?.("accountsChanged", onAccountsChanged);
    return () => {
      window.ethereum.removeListener?.("chainChanged", onChainChanged);
      window.ethereum.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, []);

  async function connect() {
    if (!provider) return alert("No wallet found.");
    try {
      const accounts = await provider.send("eth_requestAccounts", []);
      const _signer = await provider.getSigner();
      setSigner(_signer);
      setAddress(accounts[0]);
      const net = await provider.getNetwork();
      if (Number(net.chainId) !== 25) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [CRONOS_PARAMS],
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <WalletContext.Provider
      value={{ provider, signer, address, networkOk, connect }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
