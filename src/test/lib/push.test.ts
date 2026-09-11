import { describe, expect, it } from "vitest";
import {
  deviceLabel,
  isApplePlatform,
  resolvePushState,
  subscriptionToRow,
  urlBase64ToUint8Array,
  PUSH_COPY,
  type PushEnv,
} from "@/lib/push";

// Module pur des notifications push sur l'appareil. Les états qu'il calcule
// sont ce que l'agent lit sous l'interrupteur : se tromper d'état, c'est
// répondre « ce navigateur ne prend pas en charge les notifications » à
// quelqu'un qui les a simplement bloquées — et le laisser sans recours.

const base: PushEnv = {
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  isApplePlatform: false,
  isStandalone: false,
  permission: "default",
  publicKey: "BKd0-clef-publique",
  hasBrowserSubscription: false,
  rowIsMine: false,
};

describe("resolvePushState", () => {
  it("navigateur complet, rien d'abonné ⇒ off", () => {
    expect(resolvePushState(base)).toBe("off");
  });

  it("abonné ET ligne à moi ⇒ on", () => {
    expect(resolvePushState({ ...base, hasBrowserSubscription: true, rowIsMine: true })).toBe("on");
  });

  // ⚠️ LE CAS DU POSTE PARTAGÉ D'ACCUEIL : le navigateur détient un abonnement,
  // mais il appartient au collègue de la veille. Le rendre « on » ferait croire
  // à l'agent qu'il recevra ses notifications, alors qu'elles partent ailleurs.
  it("abonnement du navigateur SANS ligne à moi ⇒ off, jamais on", () => {
    expect(resolvePushState({ ...base, hasBrowserSubscription: true, rowIsMine: false })).toBe("off");
  });

  it("permission refusée ⇒ denied, avant toute autre considération", () => {
    const env = { ...base, permission: "denied" as const, hasBrowserSubscription: true, rowIsMine: true };
    expect(resolvePushState(env)).toBe("denied");
  });

  it("clé publique absente du build ⇒ not_configured", () => {
    expect(resolvePushState({ ...base, publicKey: "" })).toBe("not_configured");
    expect(resolvePushState({ ...base, publicKey: "   " })).toBe("not_configured");
  });

  // L'ordre compte : sans clé, l'interrupteur ne peut RIEN faire, même si la
  // permission est accordée. Dire « non configuré » désigne l'administrateur ;
  // dire « bloqué » enverrait l'agent fouiller ses réglages pour rien.
  it("ni clé ni permission ⇒ not_configured prime sur denied", () => {
    expect(resolvePushState({ ...base, publicKey: "", permission: "denied" })).toBe("not_configured");
  });

  describe("navigateur sans les API", () => {
    const naked = { ...base, hasServiceWorker: false, hasPushManager: false, hasNotification: false };

    it("⇒ unsupported", () => {
      expect(resolvePushState(naked)).toBe("unsupported");
    });

    // Safari iOS n'expose le push QU'EN application ajoutée à l'écran d'accueil
    // (≥ 16.4). Répondre « unsupported » à un iPhone serait faux ET sans issue :
    // il y a bien une issue, c'est « Partager › Sur l'écran d'accueil ».
    it("sur iPhone hors app installée ⇒ needs_install", () => {
      expect(resolvePushState({ ...naked, isApplePlatform: true })).toBe("needs_install");
    });

    it("sur iPhone DÉJÀ installé ⇒ unsupported (le conseil ne servirait à rien)", () => {
      expect(resolvePushState({ ...naked, isApplePlatform: true, isStandalone: true })).toBe("unsupported");
    });
  });

  it("chaque état a son texte : aucun `undefined` sous l'interrupteur", () => {
    for (const state of ["on", "off", "denied", "needs_install", "unsupported", "not_configured"] as const) {
      expect(PUSH_COPY[state].hint.length).toBeGreaterThan(10);
    }
  });
});

describe("subscriptionToRow", () => {
  const good = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: "cle-p256", auth: "sel" },
  };

  it("abonnement complet ⇒ ligne prête pour la RPC", () => {
    const row = subscriptionToRow(good, "Mozilla/5.0 (Linux; Android 14) Chrome/120");
    expect(row).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      p256dh: "cle-p256",
      auth: "sel",
      user_agent: "Android · Chrome",
    });
  });

  // La RPC refuse ces lignes côté base ; les refuser ici évite un aller-retour
  // et, surtout, un abonnement posé dans le navigateur sans ligne en face.
  it.each([
    ["endpoint non https", { ...good, endpoint: "http://exemple.fr/push" }],
    ["endpoint absent", { ...good, endpoint: null }],
    ["p256dh vide", { ...good, keys: { p256dh: "  ", auth: "sel" } }],
    ["auth absent", { ...good, keys: { p256dh: "cle", auth: null } }],
    ["pas de clés du tout", { endpoint: good.endpoint, keys: null }],
  ])("%s ⇒ null", (_label, sub) => {
    expect(subscriptionToRow(sub, "Mozilla/5.0")).toBeNull();
  });

  it("les blancs sont rognés avant l'envoi", () => {
    const row = subscriptionToRow(
      { endpoint: " https://push.example/x ", keys: { p256dh: " a ", auth: " b " } },
      "Mozilla/5.0",
    );
    expect(row?.endpoint).toBe("https://push.example/x");
    expect(row?.p256dh).toBe("a");
  });
});

describe("deviceLabel", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Safari/605", "iPhone · Safari"],
    ["Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537", "Android · Chrome"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537 Edg/120", "Windows · Edge"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Firefox/121", "Mac · Firefox"],
    ["Mozilla/5.0 (Linux; Android 14) SamsungBrowser/23 Chrome/115", "Android · Samsung Internet"],
  ])("%s ⇒ %s", (ua, expected) => {
    expect(deviceLabel(ua)).toBe(expected);
  });

  // ⚠️ Edge et Samsung Internet annoncent AUSSI « Chrome/ » : l'ordre des tests
  // dans la fonction est la seule chose qui les distingue.
  it("un agent inconnu ne rend jamais vide", () => {
    expect(deviceLabel("curl/8.4.0")).toBe("Appareil · navigateur");
  });

  it("la colonne est bornée à 200 caractères", () => {
    expect(deviceLabel("X".repeat(500)).length).toBeLessThanOrEqual(200);
  });
});

describe("isApplePlatform", () => {
  it("iPhone et iPad se reconnaissent à leur User-Agent", () => {
    expect(isApplePlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", "iPhone", 5)).toBe(true);
    expect(isApplePlatform("Mozilla/5.0 (iPad; CPU OS 17_0)", "iPad", 5)).toBe(true);
  });

  // L'iPad en mode « site pour ordinateur » se présente en Mac : seul le
  // nombre de points de contact le trahit.
  it("l'iPad déguisé en Mac est démasqué par maxTouchPoints", () => {
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 5)).toBe(true);
  });

  it("un vrai Mac n'est pas une plateforme à contrainte push", () => {
    expect(isApplePlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)", "MacIntel", 0)).toBe(false);
    expect(isApplePlatform("Mozilla/5.0 (Windows NT 10.0)", "Win32", 0)).toBe(false);
  });
});

describe("urlBase64ToUint8Array", () => {
  it("décode le base64url et rétablit le remplissage", () => {
    // « Bonjour » en base64url, sans « = » final.
    expect(new TextDecoder().decode(urlBase64ToUint8Array("Qm9uam91cg"))).toBe("Bonjour");
  });

  it("traduit `-` et `_` en `+` et `/`", () => {
    const bytes = urlBase64ToUint8Array("-_-_");
    expect(Array.from(bytes)).toEqual([251, 255, 191]);
  });

  // `pushManager.subscribe` exige un BufferSource adossé à un ArrayBuffer :
  // un SharedArrayBuffer le ferait échouer à l'exécution.
  it("rend bien un Uint8Array sur ArrayBuffer", () => {
    expect(urlBase64ToUint8Array("Qm9uam91cg").buffer).toBeInstanceOf(ArrayBuffer);
  });
});
