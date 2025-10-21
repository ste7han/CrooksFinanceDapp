import { onRequestGet as __ebisus_feed_ts_onRequestGet } from "/Users/stephandanser/Desktop/Crooks-Finance-v3/crooks-frontend/functions/ebisus-feed.ts"
import { onRequestGet as __rpc_cronos_ts_onRequestGet } from "/Users/stephandanser/Desktop/Crooks-Finance-v3/crooks-frontend/functions/rpc-cronos.ts"
import { onRequestOptions as __rpc_cronos_ts_onRequestOptions } from "/Users/stephandanser/Desktop/Crooks-Finance-v3/crooks-frontend/functions/rpc-cronos.ts"
import { onRequestPost as __rpc_cronos_ts_onRequestPost } from "/Users/stephandanser/Desktop/Crooks-Finance-v3/crooks-frontend/functions/rpc-cronos.ts"
import { onRequest as __moralis_wallet_ts_onRequest } from "/Users/stephandanser/Desktop/Crooks-Finance-v3/crooks-frontend/functions/moralis-wallet.ts"

export const routes = [
    {
      routePath: "/ebisus-feed",
      mountPath: "/",
      method: "GET",
      middlewares: [],
      modules: [__ebisus_feed_ts_onRequestGet],
    },
  {
      routePath: "/rpc-cronos",
      mountPath: "/",
      method: "GET",
      middlewares: [],
      modules: [__rpc_cronos_ts_onRequestGet],
    },
  {
      routePath: "/rpc-cronos",
      mountPath: "/",
      method: "OPTIONS",
      middlewares: [],
      modules: [__rpc_cronos_ts_onRequestOptions],
    },
  {
      routePath: "/rpc-cronos",
      mountPath: "/",
      method: "POST",
      middlewares: [],
      modules: [__rpc_cronos_ts_onRequestPost],
    },
  {
      routePath: "/moralis-wallet",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__moralis_wallet_ts_onRequest],
    },
  ]