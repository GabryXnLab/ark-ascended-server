import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Registrazione esplicita in main.tsx via `virtual:pwa-register`: niente
      // script auto-iniettato, così possiamo aggiungere polling periodico e
      // controllo su focus/visibilitychange (vedi main.tsx).
      injectRegister: false,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "ARK on-demand",
        short_name: "ARK-OD",
        description: "Gestione on-demand del server ARK: Survival Ascended.",
        lang: "it",
        theme_color: "#080808",
        background_color: "#080808",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        // IMPORTANTE: normalmente `registerType: "autoUpdate"` fa sì che il
        // plugin imposti da solo `skipWaiting`/`clientsClaim` a true, ma SOLO
        // quando `injectRegister` è "auto" o non impostato (vedi
        // node_modules/vite-plugin-pwa/dist/index.js, condizione
        // `(injectRegister === "auto" || injectRegister == null) &&
        // registerType === "autoUpdate"`). Con `injectRegister: false` questa
        // condizione non scatta più: senza impostarli qui esplicitamente, il
        // nuovo service worker resterebbe bloccato in stato "waiting" per
        // sempre (nessuno invierebbe più il messaggio SKIP_WAITING), vanificando
        // l'intero meccanismo di auto-update gestito in main.tsx.
        skipWaiting: true,
        clientsClaim: true,
        // app shell offline; le chiamate /api restano sempre dalla rete
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // in dev, proxy verso il backend per evitare CORS
    proxy: { "/api": "http://localhost:3000" },
  },
});
