import { describe, expect, it } from "vitest";
import {
  buildIrisEnvelope,
  formDataFromSocleData,
  irisErrorMessage,
  irisRequestFromBody,
  irisRequestsFromBody,
  isIrisStatus,
  requesterFromSocleData,
  shouldApplyIrisUpdate,
  type EnvelopeInput,
  type IrisEnvelope,
} from "../../../supabase/functions/_shared/iris-envelope";

// Iris est propriétaire exclusif des demandes : Clara y dépose une action
// fondée sur une DÉMARCHE du référentiel, puis n'en suit que l'état. Ce module
// décide de ce qui part — et refuse, avant tout appel réseau, ce qu'Iris
// refuserait de toute façon.

const SOCLE_DATA = {
  demandeur: {
    audience: "particulier",
    values: { civilite: "Mme", nom: "  Dupont  ", courriel: "jeanne@exemple.fr", vide: "  " },
  },
  form: [
    { id: "f1", key: "urgence", label: "Urgence", type: "select", value: "haute" },
    { id: "f2", key: "localisation", label: "Lieu", type: "text", value: "rue des Lilas" },
    { id: "f3", key: "", label: "Sans clé", type: "text", value: "ignoré" },
    { id: "f4", key: "vide", label: "Non renseigné", type: "text", value: null },
  ],
  pieces_jointes: { f9: ["doc-1", "doc-2"] },
};

const BASE: EnvelopeInput = {
  ticket: {
    id: "9c0f8f6e-1a2b-4c3d-9e8f-7a6b5c4d3e2f",
    title: "Nid-de-poule rue des Lilas",
    description: "Signalé par courrier reçu le 18 août.",
    socle_data: SOCLE_DATA,
    iris_idempotency_key: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  },
  courier: {
    id: "11111111-1111-1111-1111-111111111111",
    chrono: "2026-00412",
    subject: "Voirie dégradée",
    channel: "courrier",
    received_at: "2026-08-18T08:00:00+00:00",
    socle_organization_socle_id: "c95812a7-4695-46d1-89a6-d11e18c7945b",
  },
  procedure: { socle_id: "216fe968-f077-47b4-bd3e-8f856749ea13", name: "Signalement voirie", obsoleted_at: null },
  socleContactId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
  integration: { socle_root_org_id: "d5227d25-f327-493a-a9a2-278397531e33" },
  appOrigin: "https://clara.exemple.fr/",
};

// Le dépôt tourne sous Deno (strict) où `EnvelopeResult` se rétrécit par son
// discriminant ; le projet, lui, compile en `strict: false` où ce rétrécissement
// n'opère pas. On lit donc le résultat à plat dans les tests, sans affaiblir le
// type du module.
type FlatResult = { ok: boolean; envelope?: IrisEnvelope; message?: string };

function envelopeOf(input: EnvelopeInput): IrisEnvelope {
  const result = buildIrisEnvelope(input) as FlatResult;
  if (!result.ok || !result.envelope) {
    throw new Error(`enveloppe refusée : ${result.message}`);
  }
  return result.envelope;
}

function refusalOf(input: EnvelopeInput): string {
  const result = buildIrisEnvelope(input) as FlatResult;
  expect(result.ok).toBe(false);
  return result.message ?? "";
}

describe("buildIrisEnvelope — enveloppe conforme au contrat", () => {
  it("compose les champs obligatoires depuis le ticket, la démarche et l'intégration", () => {
    const e = envelopeOf(BASE);
    expect(e.source_system).toBe("clara");
    // L'id du TICKET : un courrier peut engendrer plusieurs demandes.
    expect(e.external_id).toBe(BASE.ticket.id);
    expect(e.idempotency_key).toBe(BASE.ticket.iris_idempotency_key);
    expect(e.socle_procedure_id).toBe("216fe968-f077-47b4-bd3e-8f856749ea13");
    expect(e.subject).toBe("Nid-de-poule rue des Lilas");
    expect(e.body).toBe("Signalé par courrier reçu le 18 août.");
  });

  it("déclare la racine de l'INTÉGRATION, pas l'organisation du courrier", () => {
    // Le périmètre est vérifié contre la clé côté Iris : un écart vaut 403.
    const e = envelopeOf(BASE);
    expect(e.socle_root_organization_id).toBe("d5227d25-f327-493a-a9a2-278397531e33");
    expect(e.socle_organization_id).toBe("c95812a7-4695-46d1-89a6-d11e18c7945b");
  });

  it("omet l'organisation destinataire quand le courrier n'en porte pas", () => {
    const e = envelopeOf({
      ...BASE,
      courier: { ...BASE.courier, socle_organization_socle_id: null },
    });
    expect(e).not.toHaveProperty("socle_organization_id");
  });

  it("porte l'usager rapproché ET l'identité déclarée (pièce du dossier)", () => {
    const e = envelopeOf(BASE);
    expect(e.socle_contact_id).toBe("3f2504e0-4f89-11d3-9a0c-0305e82c3301");
    expect(e.requester).toEqual({
      civilite: "Mme",
      nom: "Dupont",
      courriel: "jeanne@exemple.fr",
      audience: "particulier",
    });
  });

  it("indexe les réponses du formulaire par clé machine", () => {
    expect(envelopeOf(BASE).form_data).toEqual({ urgence: "haute", localisation: "rue des Lilas" });
  });

  it("situe la demande : canal, date de réception D'ORIGINE, permalien, lien courrier", () => {
    const e = envelopeOf(BASE);
    expect(e.context?.channel).toBe("courrier");
    expect(e.context?.received_at).toBe("2026-08-18T08:00:00.000Z");
    expect(e.context?.external_url).toBe("https://clara.exemple.fr/courrier/11111111-1111-1111-1111-111111111111");
    expect(e.context?.metadata).toMatchObject({ courier_chrono: "2026-00412" });
    expect(e.links).toEqual([{
      type: "courrier",
      id: "2026-00412",
      url: "https://clara.exemple.fr/courrier/11111111-1111-1111-1111-111111111111",
      label: "Voirie dégradée",
    }]);
  });

  it("n'envoie AUCUNE pièce jointe tant que le worker de copie d'Iris dort", () => {
    // Contrat 1.1.0 : « n'envoyez pas encore de pièces en production ».
    // La sélection de l'agent reste dans socle_data, prête pour plus tard.
    expect(envelopeOf(BASE)).not.toHaveProperty("attachments");
  });

  it("se rabat sur le nom de la démarche quand l'action n'a pas d'intitulé", () => {
    expect(envelopeOf({ ...BASE, ticket: { ...BASE.ticket, title: "  " } }).subject)
      .toBe("Signalement voirie");
  });

  it("tronque un sujet trop long à 500 caractères", () => {
    const e = envelopeOf({ ...BASE, ticket: { ...BASE.ticket, title: "x".repeat(600) } });
    expect(e.subject).toHaveLength(500);
  });

  it("se passe de permalien quand l'origine publique est inconnue", () => {
    const e = envelopeOf({ ...BASE, appOrigin: null });
    expect(e.context?.external_url).toBeUndefined();
    expect(e.links?.[0].url).toBeUndefined();
  });

  it("identifie le courrier par son id quand il n'a pas encore de chrono", () => {
    const e = envelopeOf({ ...BASE, courier: { ...BASE.courier, chrono: null } });
    expect(e.links?.[0].id).toBe(BASE.courier.id);
  });

  it("accepte un dépôt sans identité déclarée dès lors qu'un contact est rapproché", () => {
    const e = envelopeOf({ ...BASE, ticket: { ...BASE.ticket, socle_data: { form: [] } } });
    expect(e.requester).toBeUndefined();
    expect(e.socle_contact_id).toBeTruthy();
  });
});

describe("buildIrisEnvelope — refus, avant tout appel réseau", () => {
  it("laisse une demande libre dans Clara, sans en faire un incident", () => {
    expect(refusalOf({ ...BASE, procedure: null })).toContain("reste dans Clara");
    expect(refusalOf({ ...BASE, procedure: { socle_id: null, name: "Locale" } }))
      .toContain("reste dans Clara");
  });

  it("refuse une démarche obsolète — Iris la refuserait aussi", () => {
    expect(refusalOf({
      ...BASE,
      procedure: { ...BASE.procedure!, obsoleted_at: "2026-08-01T00:00:00Z" },
    })).toContain("obsolète");
  });

  it("refuse une intégration sans organisation racine", () => {
    expect(refusalOf({ ...BASE, integration: { socle_root_org_id: null } })).toContain("racine");
  });

  it("refuse une demande sans demandeur, et dit comment la réparer", () => {
    const message = refusalOf({
      ...BASE,
      socleContactId: null,
      ticket: { ...BASE.ticket, socle_data: { form: [] } },
    });
    expect(message).toContain("rapprochez");
    expect(message).toContain("référentiel");
  });
});

describe("extractions depuis socle_data", () => {
  it("ignore les entrées sans clé machine ou sans valeur", () => {
    expect(formDataFromSocleData(SOCLE_DATA)).toEqual({ urgence: "haute", localisation: "rue des Lilas" });
  });

  it("rend undefined plutôt qu'un objet vide", () => {
    expect(formDataFromSocleData({ form: [] })).toBeUndefined();
    expect(formDataFromSocleData(null)).toBeUndefined();
    expect(requesterFromSocleData({ demandeur: null })).toBeUndefined();
    expect(requesterFromSocleData({ demandeur: { audience: "", values: { a: "  " } } })).toBeUndefined();
  });

  it("survit à un socle_data absent ou mal formé", () => {
    for (const bad of [undefined, null, "texte", 42, []]) {
      expect(formDataFromSocleData(bad)).toBeUndefined();
      expect(requesterFromSocleData(bad)).toBeUndefined();
    }
  });
});

describe("lecture des réponses enveloppées", () => {
  it("extrait la demande d'un dépôt { created, request }", () => {
    const dto = irisRequestFromBody({
      created: true,
      request: { id: "abc", reference: "DEM-2026-000123", status: "a_traiter", version: 1 },
      attachments_pending: 0,
    });
    expect(dto?.reference).toBe("DEM-2026-000123");
  });

  it("extrait la liste d'une réconciliation { requests: [...] }", () => {
    expect(irisRequestsFromBody({ requests: [{ id: "a" }, { id: "b" }] })).toHaveLength(2);
    expect(irisRequestsFromBody({ requests: [] })).toEqual([]);
  });

  it("rend null sur une réponse d'une autre forme — illisible n'est pas vide", () => {
    // Un tableau nu, une erreur, un corps absent : trois façons de ne PAS être
    // la réponse documentée. Les confondre avec « rien à faire » ferait passer
    // une panne pour un silence.
    for (const bad of [null, undefined, [], { error: { code: "forbidden" } }, "texte"]) {
      expect(irisRequestsFromBody(bad)).toBeNull();
      expect(irisRequestFromBody(bad)).toBeNull();
    }
    expect(irisRequestFromBody({ request: [] })).toBeNull();
  });
});

describe("garde de version (réconciliation)", () => {
  it("applique une version qui dépasse celle connue", () => {
    expect(shouldApplyIrisUpdate(3, 4)).toBe(true);
    expect(shouldApplyIrisUpdate(null, 1)).toBe(true);
    expect(shouldApplyIrisUpdate(undefined, 7)).toBe(true);
  });

  it("ignore un rejeu ou une arrivée en désordre", () => {
    expect(shouldApplyIrisUpdate(4, 4)).toBe(false);
    expect(shouldApplyIrisUpdate(4, 2)).toBe(false);
  });

  it("ignore une réponse sans version exploitable", () => {
    expect(shouldApplyIrisUpdate(1, null)).toBe(false);
    expect(shouldApplyIrisUpdate(1, undefined)).toBe(false);
    expect(shouldApplyIrisUpdate(1, Number.NaN)).toBe(false);
  });
});

describe("statuts et messages d'erreur", () => {
  it("ne reconnaît que les statuts de la liste fermée", () => {
    expect(isIrisStatus("en_instruction")).toBe(true);
    expect(isIrisStatus("resolue_positive")).toBe(true);
    expect(isIrisStatus("en_cours")).toBe(false);
    expect(isIrisStatus(null)).toBe(false);
  });

  it("reprend le message d'Iris quand il est utile", () => {
    expect(irisErrorMessage(400, { error: { code: "bad_request", message: "Démarche inconnue." } }))
      .toBe("Démarche inconnue.");
  });

  it("dit quoi faire là où le code seul ne suffit pas", () => {
    expect(irisErrorMessage(401, null)).toContain("administrateur Iris");
    expect(irisErrorMessage(403, null)).toContain("Périmètre");
    expect(irisErrorMessage(409, null)).toContain("rien n'a été écrasé");
    expect(irisErrorMessage(500, null)).toContain("500");
  });
});
