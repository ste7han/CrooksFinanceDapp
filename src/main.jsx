// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";
import { WalletProvider } from "./context/WalletContext.jsx";
import { EmpireProvider } from "./context/EmpireContext.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WalletProvider>
      <EmpireProvider>
        <App />
      </EmpireProvider>
    </WalletProvider>
  </React.StrictMode>
);
