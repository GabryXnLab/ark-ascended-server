/// <reference types="vite-plugin-pwa/client" />
import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { AuthShell } from "./AuthShell";
import "./styles.css";

// Intervallo di polling per i controlli periodici di aggiornamento del service
// worker. Questa PWA governa un server ARK on-demand con deploy poco
// frequenti (push manuali su `main`, non più volte al giorno): non serve un
// controllo aggressivo, ma vogliamo comunque che una copia installata e
// lasciata aperta per ore/giorni non resti bloccata su una build vecchia.
// 45 minuti è un compromesso ragionevole tra "si accorge abbastanza in
// fretta di un nuovo deploy" e "non genera richieste di rete inutili".
const UPDATE_CHECK_INTERVAL_MS = 45 * 60 * 1000;

// `registerType: "autoUpdate"` fa sì che, lato client, il modulo generato da
// vite-plugin-pwa (vedi node_modules/vite-plugin-pwa/dist/client/build/register.js)
// non invochi mai `onNeedRefresh`: quando il nuovo service worker raggiunge lo
// stato "activated" con un aggiornamento in corso, la libreria stessa chiama
// `window.location.reload()`. Per questo qui non serve gestire
// `onNeedRefresh` né mostrare un prompt: l'aggiornamento è già silenzioso.
// Aggiungiamo comunque un listener su `controllerchange` come rete di
// sicurezza (pattern raccomandato da web.dev/MDN per i service worker): può
// scattare leggermente prima/indipendentemente dall'evento "activated"
// interno alla libreria e garantisce che i client aperti prendano sempre il
// nuovo bundle JS/CSS quando cambia il service worker attivo.
let refreshing = false;
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (refreshing) return;
  refreshing = true;
  window.location.reload();
});

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swScriptUrl, registration) {
    if (!registration) return;

    // Controllo periodico: utile se l'app resta aperta a lungo in background
    // (es. su un dispositivo lasciato acceso) senza mai essere ricaricata.
    setInterval(() => {
      registration.update().catch(() => {
        // rete assente/temporaneamente irraggiungibile: si riproverà al giro successivo
      });
    }, UPDATE_CHECK_INTERVAL_MS);

    // Controllo su ritorno in primo piano: quando l'utente riapre l'app
    // installata dopo che era in background, è il momento più naturale per
    // verificare se esiste una versione nuova.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        registration.update().catch(() => {});
      }
    });
    window.addEventListener("focus", () => {
      registration.update().catch(() => {});
    });
  },
});

// Con `registerType: "autoUpdate"` `updateSW` non richiede input utente (nessun
// banner): la teniamo comunque per coerenza con l'API di vite-plugin-pwa.
void updateSW;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthShell />
  </React.StrictMode>,
);
