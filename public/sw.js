// Service worker de Clara — PUSH SEULEMENT.
//
// Aucun gestionnaire `fetch`, aucun cache : Clara ne fonctionne pas hors ligne
// et ne doit jamais servir une version périmée depuis un cache (une GEC affiche
// des états de workflow, pas des articles de blog). Ce fichier existe pour une
// seule chose : recevoir les Web Push envoyés par l'edge function
// `notifications-push` et ouvrir le courrier au clic.
//
// Il n'est enregistré QUE lorsque l'agent active « Notifications sur cet
// appareil » : sans abonnement il ne recevrait rien, et un service worker posé
// d'office est un cycle de vie de plus à déboguer pour zéro bénéfice.
//
// Servi tel quel depuis `public/` à `/sw.js` (portée `/`). Pas de bundling : il
// ne dépend de rien, et son URL doit rester stable — un nom haché par Vite
// ferait perdre son abonnement à chaque mise en ligne.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function readPayload(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const data = readPayload(event);
  // Un push sans contenu lisible (ou un push de test envoyé à la main) affiche
  // quand même une carte : Chrome l'exige (`userVisibleOnly`), et « Clara »
  // vaut mieux que « Ce site a été mis à jour en arrière-plan ».
  const title = (data && typeof data.title === "string" && data.title) || "Clara";
  const options = {
    body: (data && typeof data.body === "string") ? data.body : "",
    icon: "/favicon.png",
    badge: "/favicon.png",
    tag: (data && typeof data.tag === "string") ? data.tag : undefined,
    renotify: Boolean(data && data.tag),
    data: { url: (data && typeof data.url === "string") ? data.url : "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const origin = self.location.origin;
    const target = new URL(url, origin);
    const same = all.find((c) => c.url && c.url.startsWith(origin));
    if (same) {
      // L'application est ouverte : on la ramène au premier plan et on lui
      // demande de naviguer (une SPA préfère être avertie que rechargée — un
      // rechargement perdrait le brouillon de réponse en cours de saisie).
      try { await same.focus(); } catch { /* onglet non focalisable */ }
      try {
        same.postMessage({ type: "clara:navigate", url: target.pathname + target.search });
      } catch {
        if ("navigate" in same) await same.navigate(target.href);
      }
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

// Le navigateur a renouvelé l'abonnement (rotation de clés du service de push) :
// on se réabonne avec la même clé serveur et on prévient l'application, qui
// réenregistrera la nouvelle adresse au prochain chargement — le service
// worker, lui, n'a pas de session Supabase pour le faire.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const old = event.oldSubscription;
    const key = old && old.options && old.options.applicationServerKey;
    if (!key) return;
    const sub = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) c.postMessage({ type: "clara:push-resubscribed", subscription: sub.toJSON() });
  })());
});
