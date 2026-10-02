import { describe, expect, it } from "vitest";
import {
  notificationPath,
  pushMessage,
  strippedTitle,
  truncate,
  PUSH_BODY_MAX,
  PUSH_TITLES,
} from "../../../supabase/functions/_shared/push/message";
import { decideOutcome, isGone } from "../../../supabase/functions/_shared/push/outcome";
import { readVapid, PUSH_TTL_SECONDS } from "../../../supabase/functions/_shared/push/config";

// Modules PURS de l'edge function `notifications-push`. Ils décident ce qui
// s'affiche sur un écran verrouillé et ce qu'on fait d'un envoi raté : les
// tester ici, en vitest, évite d'avoir à déployer pour vérifier une phrase.

const APP = "https://clara.edilumen.fr";

describe("pushMessage", () => {
  it("courrier entrant : motif + collectivité en titre, objet en corps", () => {
    const m = pushMessage({
      type: "new_courier",
      title: "Demande de subvention 2026",
      resourceId: "c-1",
      organizationName: "Mairie d'Arles",
      appUrl: APP,
    });
    expect(m.title).toBe("Nouveau courrier · Mairie d'Arles");
    expect(m.body).toBe("Demande de subvention 2026");
    expect(m.url).toBe("https://clara.edilumen.fr/a-instruire?open=c-1");
  });

  // Le producteur préfixe `title` (« Transféré : … »), et la cloche retire ce
  // préfixe à l'affichage. La carte porte déjà le motif dans SON titre : le
  // répéter mangerait la moitié des 140 caractères utiles.
  it.each([
    ["courier_transferred", "Transféré : Réclamation voirie", "Courrier transféré", "Réclamation voirie"],
    ["action_assigned", "Action affectée : Instruire le dossier", "Action affectée", "Instruire le dossier"],
    ["action_unassigned", "Affectation retirée : Instruire le dossier", "Affectation retirée", "Instruire le dossier"],
  ])("%s : le préfixe du producteur ne se répète pas", (type, title, head, body) => {
    const m = pushMessage({ type, title, resourceId: "c-2", organizationName: null, appUrl: APP });
    expect(m.title).toBe(head);
    expect(m.body).toBe(body);
  });

  it("sans collectivité connue, le titre reste le seul motif", () => {
    const m = pushMessage({
      type: "new_courier", title: "Objet", resourceId: "c-3", organizationName: "  ", appUrl: APP,
    });
    expect(m.title).toBe("Nouveau courrier");
  });

  // Une communauté d'agglomération porte des noms de soixante caractères : sans
  // borne, le motif serait poussé hors de la carte par le nom.
  it("un nom de collectivité trop long est tronqué, pas le motif", () => {
    const m = pushMessage({
      type: "new_courier",
      title: "Objet",
      resourceId: "c-4",
      organizationName: "Communauté d'Agglomération Arles Crau Camargue Montagnette",
      appUrl: APP,
    });
    expect(m.title.startsWith("Nouveau courrier · ")).toBe(true);
    expect(m.title.endsWith("…")).toBe(true);
    expect(m.title.length).toBeLessThan(65);
  });

  it("un corps trop long est tronqué sur un espace, avec une ellipse", () => {
    const m = pushMessage({
      type: "new_courier",
      title: "Demande de subvention de fonctionnement pour le club de football municipal au titre de la saison sportive à venir, accompagnée des pièces justificatives et du bilan comptable",
      resourceId: "c-5",
      organizationName: null,
      appUrl: APP,
    });
    expect(m.body.length).toBeLessThanOrEqual(PUSH_BODY_MAX);
    expect(m.body.endsWith("…")).toBe(true);
    expect(m.body).not.toContain(" …");
  });

  // Une ligne sans `title` existe (le producteur retombe sur COALESCE, un
  // transfert sans objet…) : une carte vide serait pire qu'inutile, elle ferait
  // vibrer le téléphone pour rien.
  it.each([
    ["new_courier", "Un courrier vient d'arriver."],
    ["courier_transferred", "Un courrier vous a été transféré."],
    ["action_assigned", "Une action vous a été affectée."],
    ["action_unassigned", "Une affectation vous a été retirée."],
  ])("%s sans titre ⇒ une phrase de repli, jamais un corps vide", (type, expected) => {
    expect(pushMessage({ type, title: null, resourceId: "c-6", organizationName: null, appUrl: APP }).body)
      .toBe(expected);
    expect(pushMessage({ type, title: "   ", resourceId: "c-6", organizationName: null, appUrl: APP }).body)
      .toBe(expected);
  });

  // Tolérance à l'inconnu : un type ajouté par une version ultérieure du
  // backend ne doit pas produire une carte cassée sur un téléphone qui tourne
  // encore avec l'ancienne fonction.
  it("type inconnu : carte générique, jamais d'échec", () => {
    const m = pushMessage({
      type: "courier_deadline_soon", title: "Échéance", resourceId: "c-7", organizationName: null, appUrl: APP,
    });
    expect(m.title).toBe("Notification");
    expect(m.body).toBe("Échéance");
    expect(m.url).toBe("https://clara.edilumen.fr/a-instruire?open=c-7");
  });

  it("un type inconnu SANS titre a quand même une phrase", () => {
    const m = pushMessage({
      type: "inconnu", title: null, resourceId: null, organizationName: null, appUrl: APP,
    });
    expect(m.body).toBe("Une notification vous attend dans Clara.");
  });

  // Le regroupement met UNE carte par courrier sur le téléphone : la plus
  // récente remplace la précédente, au lieu d'empiler dix cartes pour le même
  // dossier passé par trois états.
  it("le tag regroupe par courrier", () => {
    expect(pushMessage({ type: "new_courier", title: "x", resourceId: "c-8", organizationName: null, appUrl: APP }).tag)
      .toBe("clara:c-8");
  });

  it("sans ressource, pas de tag (sinon toutes les cartes s'écraseraient)", () => {
    const m = pushMessage({ type: "new_courier", title: "x", resourceId: null, organizationName: null, appUrl: APP });
    expect(m.tag).toBeUndefined();
    expect(m.url).toBe("https://clara.edilumen.fr/");
  });

  // APP_ORIGIN absente ou mal formée : un chemin relatif reste cliquable, le
  // service worker le résout sur sa propre origine. Une URL « undefined/… »
  // ouvrirait une page d'erreur.
  it.each([["", "/a-instruire?open=c-9"], ["pas-une-url", "/a-instruire?open=c-9"]])(
    "appUrl invalide (%s) ⇒ chemin relatif",
    (appUrl, expected) => {
      expect(pushMessage({ type: "new_courier", title: "x", resourceId: "c-9", organizationName: null, appUrl }).url)
        .toBe(expected);
    },
  );

  it("une barre finale en trop ne produit pas de double slash", () => {
    const m = pushMessage({
      type: "new_courier", title: "x", resourceId: "c-10", organizationName: null, appUrl: "https://clara.edilumen.fr///",
    });
    expect(m.url).toBe("https://clara.edilumen.fr/a-instruire?open=c-10");
  });
});

// ⚠️ PARITÉ AVEC LA CLOCHE : le permalien du push doit mener là où mène le clic
// dans `NotificationBell.handleNotificationClick`, et là où mène le lien des
// e-mails d'affectation. Trois chemins divergents pour un même événement, et
// c'est l'agent qui cherche son dossier.
describe("notificationPath", () => {
  it("une action ouvre l'onglet « Actions liées » de la fiche", () => {
    expect(notificationPath("action_assigned", "c-1")).toBe("/courrier/c-1?tab=actions");
    expect(notificationPath("action_unassigned", "c-1")).toBe("/courrier/c-1?tab=actions");
  });

  it("tout le reste ouvre le courrier dans « À instruire »", () => {
    expect(notificationPath("new_courier", "c-1")).toBe("/a-instruire?open=c-1");
    expect(notificationPath("courier_transferred", "c-1")).toBe("/a-instruire?open=c-1");
  });

  it("sans ressource, la racine — jamais une URL trouée", () => {
    expect(notificationPath("new_courier", null)).toBe("/");
    expect(notificationPath("new_courier", "  ")).toBe("/");
  });
});

describe("strippedTitle et truncate", () => {
  it("le préfixe n'est retiré que pour le type qui le pose", () => {
    expect(strippedTitle("courier_transferred", "Transféré : Objet")).toBe("Objet");
    // Un objet de courrier qui commencerait par « Transféré : » reste intact
    // sur un autre type : on ne devine pas, on connaît le producteur.
    expect(strippedTitle("new_courier", "Transféré : Objet")).toBe("Transféré : Objet");
  });

  it("un titre nul ou non textuel ⇒ chaîne vide, jamais « null »", () => {
    expect(strippedTitle("new_courier", null)).toBe("");
  });

  it("truncate coupe sur un espace quand il y en a un dans la seconde moitié", () => {
    expect(truncate("un deux trois quatre", 14)).toBe("un deux trois…");
  });

  it("truncate coupe net quand le mot est plus long que la limite", () => {
    expect(truncate("anticonstitutionnellement", 10)).toBe("anticonst…");
  });

  it("truncate ne touche pas ce qui tient", () => {
    expect(truncate("court", 40)).toBe("court");
  });
});

describe("PUSH_TITLES", () => {
  it("couvre les six types que Clara produit aujourd'hui", () => {
    expect(Object.keys(PUSH_TITLES).sort()).toEqual([
      "action_assigned",
      "action_unassigned",
      "courier_reminder",
      "courier_returned",
      "courier_transferred",
      "new_courier",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Règlement d'un envoi vers N appareils
// ---------------------------------------------------------------------------

describe("decideOutcome", () => {
  const ok = { subscriptionId: "s1", status: 201 };

  it("un seul appareil servi suffit : le destinataire est prévenu", () => {
    const o = decideOutcome([ok, { subscriptionId: "s2", status: 500 }]);
    expect(o.settle).toBe("sent");
    expect(o.error).toBeNull();
  });

  // ⚠️ 404/410 = l'abonnement n'existe plus (désinstallation, permission
  // révoquée). Le réessayer cinq fois ne le ressuscitera pas, et la ligne
  // finirait `failed` pour un appareil disparu — d'où la désactivation.
  it("404 et 410 désactivent l'abonnement, même quand l'envoi a réussi ailleurs", () => {
    const o = decideOutcome([ok, { subscriptionId: "s2", status: 410 }, { subscriptionId: "s3", status: 404 }]);
    expect(o.settle).toBe("sent");
    expect(o.disable.sort()).toEqual(["s2", "s3"]);
  });

  it("tous les appareils disparus : rien à réessayer, mais la ligne le dit", () => {
    const o = decideOutcome([{ subscriptionId: "s1", status: 410 }]);
    expect(o.settle).toBe("retry");
    expect(o.disable).toEqual(["s1"]);
    expect(o.error).toBe("tous les appareils ont disparu");
  });

  // 401/403 ne disent pas « cet appareil » mais « toute la file » : c'est la
  // configuration VAPID qui est fausse. Le message doit permettre de le voir
  // dans `push_error` sans lire les journaux de la fonction.
  it("401/403 nomment les clés VAPID", () => {
    expect(decideOutcome([{ subscriptionId: "s1", status: 401 }]).error).toBe("HTTP 401 (clés VAPID refusées)");
    expect(decideOutcome([{ subscriptionId: "s1", status: 403 }]).error).toBe("HTTP 403 (clés VAPID refusées)");
  });

  it("les causes identiques sont dédupliquées (dix appareils, un message)", () => {
    const o = decideOutcome([
      { subscriptionId: "s1", status: 503 },
      { subscriptionId: "s2", status: 503 },
      { subscriptionId: "s3", status: 429 },
    ]);
    expect(o.error).toBe("HTTP 503 · HTTP 429");
  });

  it("un appel qui n'aboutit pas relaie son erreur, ou « erreur réseau »", () => {
    expect(decideOutcome([{ subscriptionId: "s1", status: null, error: "timeout" }]).error).toBe("timeout");
    expect(decideOutcome([{ subscriptionId: "s1", status: null }]).error).toBe("erreur réseau");
  });

  // Ne devrait pas arriver (le claim renonce aux lignes sans appareil), mais un
  // « sent » sur zéro envoi mentirait sur l'état de la boîte.
  it("aucun appareil ⇒ retry, jamais sent", () => {
    expect(decideOutcome([])).toEqual({ settle: "retry", disable: [], error: "aucun appareil" });
  });

  it("le résumé reste sous la borne de la colonne", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ subscriptionId: `s${i}`, status: 500 + i }));
    expect(decideOutcome(many).error!.length).toBeLessThanOrEqual(500);
  });

  it("isGone ne reconnaît que 404 et 410", () => {
    expect(isGone(404)).toBe(true);
    expect(isGone(410)).toBe(true);
    expect(isGone(400)).toBe(false);
    expect(isGone(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Configuration VAPID
// ---------------------------------------------------------------------------

describe("readVapid", () => {
  const full = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:contact@edilumen.fr" };

  it("les trois secrets présents ⇒ configuration", () => {
    expect(readVapid(full)).toEqual({ publicKey: "pub", privateKey: "priv", subject: "mailto:contact@edilumen.fr" });
  });

  it("un sujet https est accepté aussi", () => {
    expect(readVapid({ ...full, VAPID_SUBJECT: "https://clara.edilumen.fr" })?.subject)
      .toBe("https://clara.edilumen.fr");
  });

  // ⚠️ `null` fait répondre 503 SANS réclamer de lot : réclamer consommerait
  // les tentatives d'une file qu'on ne peut pas servir, et cinq minutes plus
  // tard toute la file serait `failed` — pour une variable d'environnement.
  it.each([
    ["clé publique absente", { ...full, VAPID_PUBLIC_KEY: "" }],
    ["clé privée absente", { ...full, VAPID_PRIVATE_KEY: "   " }],
    ["sujet absent", { ...full, VAPID_SUBJECT: "" }],
    ["sujet ni mailto: ni https:", { ...full, VAPID_SUBJECT: "contact@edilumen.fr" }],
    ["environnement vide", {}],
  ])("%s ⇒ null", (_label, env) => {
    expect(readVapid(env)).toBeNull();
  });

  it("les blancs autour des secrets sont rognés", () => {
    expect(readVapid({ ...full, VAPID_PUBLIC_KEY: "  pub  " })?.publicKey).toBe("pub");
  });

  // Un téléphone éteint le week-end doit encore recevoir l'action affectée
  // vendredi soir ; au-delà, la cloche fait le reste.
  it("le TTL couvre 24 h", () => {
    expect(PUSH_TTL_SECONDS).toBe(86_400);
  });
});
