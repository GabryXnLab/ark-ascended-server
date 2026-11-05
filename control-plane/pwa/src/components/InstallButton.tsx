import { useEffect, useState } from "react";
import { Download, Smartphone, X, Share } from "lucide-react";

// Evento non ancora nei lib DOM standard di TS.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

// Nelle WebView iOS (WKWebView) lo user agent non contiene "Safari/": il foglio di
// condivisione con «Aggiungi a schermata Home» non esiste, quindi le istruzioni sarebbero false.
function isIosWebView(): boolean {
  return isIos() && !/safari\//i.test(window.navigator.userAgent);
}

/**
 * Pulsante "Installa app". Usa l'evento `beforeinstallprompt` su Chrome/Android/desktop;
 * su iOS (che non lo espone) mostra le istruzioni per "Aggiungi a schermata Home".
 */
export function InstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Già installata: niente da mostrare.
  if (installed || isIosWebView()) return null;

  // iOS: nessun prompt nativo → istruzioni manuali.
  if (isIos()) {
    return (
      <>
        <button className="install-btn" aria-label="Installa l’app" onClick={() => setShowIosHelp(true)}>
          <Download size={14} /> <span className="install-label">Installa</span>
        </button>
        {showIosHelp && (
          <div className="ios-help-banner" role="status">
            <div className="ios-help-content">
              <span className="ios-help-icon">
                <Smartphone size={20} />
              </span>
              <span>
                Per installare: tocca il pulsante di <strong>Condividi</strong>{" "}
                <Share size={13} style={{ verticalAlign: "middle", color: "var(--rune-light)" }} />
                {" "}in Safari, poi seleziona <strong>«Aggiungi a schermata Home»</strong>.
              </span>
            </div>
            <button className="ios-help-close" onClick={() => setShowIosHelp(false)} aria-label="Chiudi">
              <X size={16} />
            </button>
          </div>
        )}
      </>
    );
  }

  // Chrome/Android/desktop: mostra solo se il browser ha emesso l'evento.
  if (!deferred) return null;

  return (
    <button
      className="install-btn"
      aria-label="Installa l’app"
      onClick={async () => {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") setInstalled(true);
        setDeferred(null);
      }}
    >
      <Download size={14} /> <span className="install-label">Installa</span>
    </button>
  );
}
