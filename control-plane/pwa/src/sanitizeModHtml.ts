// Sanitizza l'HTML della descrizione mod (contenuto di terzi da CurseForge) prima
// di renderizzarlo. Permette iframe solo da host video noti, per abilitare i
// video incorporati (YouTube/Vimeo) senza aprire a XSS via iframe arbitrari.

import DOMPurify from "dompurify";

const ALLOWED_IFRAME_HOSTS = new Set([
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
]);

DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName !== "iframe") return;
  const el = node as Element;
  const src = el.getAttribute("src") ?? "";
  let host = "";
  try {
    host = new URL(src, window.location.href).hostname;
  } catch {
    // src non valido: verrà rimosso sotto.
  }
  if (!ALLOWED_IFRAME_HOSTS.has(host)) el.remove();
});

export function sanitizeModHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling", "target"],
  });
}
