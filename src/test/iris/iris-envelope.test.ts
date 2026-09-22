import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attachmentsRefusedNote,
  buildIrisEnvelope,
  formDataFromSocleData,
  irisErrorMessage,
  irisRequestFromBody,
  irisRequestsFromBody,
  irisTicketPatch,
  isDefiniteUploadRefusal,
  isIrisStatus,
  IRIS_MAX_UPLOAD_BYTES,
  planIrisAttachments,
  requesterFromSocleData,
  shouldApplyIrisUpdate,
  uploadRefusalMessage,
  withIrisAttachments,
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

  it("transmet les consentements du dépôt portail — kind et granted SEULEMENT", () => {
    const e = envelopeOf({
      ...BASE,
      courier: {
        ...BASE.courier,
        consents: [
          { kind: "partage", granted: false, statement: "Phrase lue.", collected_at: "2026-08-18T08:00:00Z" },
          { kind: "traitement", granted: true, statement: "Phrase lue.", collected_at: "2026-08-18T08:00:00Z" },
        ],
      },
    });
    // Ordre du catalogue, aucune phrase : Iris compose la sienne (contrat 2.2.0).
    expect(e.consents).toEqual([
      { kind: "traitement", granted: true },
      { kind: "partage", granted: false },
    ]);
  });

  it("omet les consentements sans trace, ou sans le traitement accordé (Iris pose une anomalie, pas un 400)", () => {
    expect(envelopeOf(BASE)).not.toHaveProperty("consents");
    expect(envelopeOf({ ...BASE, courier: { ...BASE.courier, consents: [] } })).not.toHaveProperty("consents");
    expect(envelopeOf({
      ...BASE,
      courier: { ...BASE.courier, consents: [{ kind: "partage", granted: true, statement: "x" }] },
    })).not.toHaveProperty("consents");
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
  // L'écran n'en crée plus (démarche obligatoire depuis le 2026-09-11), mais un
  // ticket d'avant — ou une démarche Arpège, sans `socle_id` — reste déposable
  // à la main : la garde doit tenir sans crier à la panne.
  it("laisse une action sans démarche du référentiel dans Clara, sans en faire un incident", () => {
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

describe("écriture d'une lecture d'Iris sur le ticket", () => {
  const DEMANDE = {
    id: "d2c3829b-c9ea-4683-b5c5-b4283e1d6834",
    reference: "DEM-2026-000054",
    status: "resolue_positive",
    version: 5,
    url: "https://iris.exemple.fr/demandes/DEM-2026-000054",
    updated_at: "2026-09-11T12:53:03.969Z",
  };

  it("reporte l'état servi par Iris, et efface l'erreur de dépôt", () => {
    // `iris_last_error` ne parle que du DÉPÔT : une lecture réussie prouve que
    // la demande est arrivée, le bouton « Renvoyer » n'a plus lieu d'être.
    expect(irisTicketPatch(DEMANDE, "2026-09-11T13:00:00.000Z")).toEqual({
      iris_request_id: "d2c3829b-c9ea-4683-b5c5-b4283e1d6834",
      iris_reference: "DEM-2026-000054",
      iris_status: "resolue_positive",
      iris_version: 5,
      iris_url: "https://iris.exemple.fr/demandes/DEM-2026-000054",
      iris_synced_at: "2026-09-11T13:00:00.000Z",
      iris_last_error: null,
    });
  });

  it("n'écrit jamais un statut hors de la liste fermée", () => {
    // Iris est libre d'ajouter un statut (contrat additif) : Clara préfère ne
    // rien afficher plutôt qu'afficher une clé qu'elle ne sait pas traduire.
    const patch = irisTicketPatch({ ...DEMANDE, status: "en_cours_de_quelque_chose" }, "T");
    expect(patch.iris_status).toBeNull();
  });

  it("tolère une demande servie sans référence, sans url, sans version", () => {
    const patch = irisTicketPatch({ id: "x" }, "T");
    expect(patch).toMatchObject({
      iris_request_id: "x",
      iris_reference: null,
      iris_url: null,
      iris_version: null,
      iris_status: null,
    });
  });

  // Non-régression : les DEUX chemins de lecture doivent passer par ce patch.
  // Une écriture réinventée dans l'un des deux ferait dépendre l'état affiché de
  // qui a lu en dernier — et c'est le genre d'écart qui ne casse aucun test.
  it.each(["sync-iris-requests", "refresh-iris-status"])(
    "%s écrit l'état via irisTicketPatch, sans le réinventer",
    (fn) => {
      const source = readFileSync(
        join(process.cwd(), "supabase", "functions", fn, "index.ts"),
        "utf8",
      );
      expect(source).toContain("irisTicketPatch(");
      expect(source).not.toMatch(/iris_status:\s/);
    },
  );
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

// ── Pièces jointes (contrat 2.0.0) ─────────────────────────────────────────
//
// Ne partent QUE les pièces réclamées par le formulaire de la démarche, cochées
// par l'agent : `socle_data.pieces_jointes` les indexe par **id** de champ,
// Iris attend la **clé machine**. Le pont est le `form_schema` de la démarche.

const FORM_SCHEMA = {
  version: 1,
  content: [
    { id: "f-sub-01", key: "objet", type: "text", label: "Objet" },
    {
      id: "s1",
      kind: "section",
      title: "Pièces",
      fields: [
        { id: "f-sub-12", key: "statuts", type: "attachment", label: "Statuts de l'association" },
      ],
    },
    { id: "f-sub-13", key: "rib", type: "attachment", label: "Relevé d'identité bancaire" },
  ],
};

const DOCS = [
  { id: "doc-statuts", storage_key: "org/statuts.pdf", file_name: "statuts.pdf", mime_type: "application/pdf", file_size: 12_000 },
  { id: "doc-rib", storage_key: "org/rib.pdf", file_name: "rib.pdf", mime_type: "application/pdf", file_size: 2_000 },
];

function planOf(pieces: Record<string, unknown>, documents = DOCS) {
  return planIrisAttachments({
    socleData: { pieces_jointes: pieces },
    formSchema: FORM_SCHEMA,
    documents,
  });
}

describe("planIrisAttachments — quelles pièces partent, et sous quelle clé", () => {
  it("traduit l'id du champ en clé machine, jusque dans une section", () => {
    const plan = planOf({ "f-sub-12": ["doc-statuts"], "f-sub-13": ["doc-rib"] });
    expect(plan.dropped).toEqual([]);
    expect(plan.items.map((i) => [i.fileName, i.formFieldKey])).toEqual([
      ["statuts.pdf", "statuts"],
      ["rib.pdf", "rib"],
    ]);
  });

  it("ne dépose qu'une fois un document coché sur deux champs", () => {
    // Iris refuse (400) un upload_id référencé deux fois, et deux dépôts du
    // même fichier feraient un doublon dans le dossier.
    const plan = planOf({ "f-sub-12": ["doc-rib"], "f-sub-13": ["doc-rib"] });
    expect(plan.items).toHaveLength(1);
  });

  it("laisse partir « hors champ » une pièce dont le champ a disparu du formulaire", () => {
    // Démarche resynchronisée depuis la saisie : perdre le fichier serait pire
    // que le montrer sans rattachement à un champ.
    const plan = planOf({ "f-disparu": ["doc-rib"] });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].formFieldKey).toBeNull();
    expect(plan.dropped).toEqual([]);
  });

  it("écarte, en le nommant, un document que Clara ne retrouve pas", () => {
    const plan = planOf({ "f-sub-13": ["doc-fantome"] });
    expect(plan.items).toEqual([]);
    expect(plan.dropped[0]).toMatchObject({
      fieldLabel: "Relevé d'identité bancaire",
      reason: "document introuvable dans Clara",
    });
  });

  it("écarte avant le réseau un fichier au-delà de 25 Mo", () => {
    const plan = planOf({ "f-sub-13": ["doc-rib"] }, [
      { ...DOCS[1], file_size: IRIS_MAX_UPLOAD_BYTES + 1 },
    ]);
    expect(plan.items).toEqual([]);
    expect(plan.dropped[0].reason).toContain("25 Mo");
  });

  it("ne plante pas sur une action sans pièce ni sur un schéma illisible", () => {
    expect(planIrisAttachments({ socleData: null, formSchema: null, documents: [] }).items).toEqual([]);
    expect(planOf({})).toEqual({ items: [], dropped: [] });
  });
});

describe("pièces jointes — enveloppe et refus", () => {
  it("n'ajoute `attachments` que lorsqu'une pièce a été déposée", () => {
    const bare = envelopeOf(BASE);
    expect(withIrisAttachments(bare, [])).not.toHaveProperty("attachments");
    expect(withIrisAttachments(bare, [{ upload_id: "u1", form_field_key: "rib" }]).attachments)
      .toEqual([{ upload_id: "u1", form_field_key: "rib" }]);
  });

  it("distingue le refus définitif d'un fichier de la panne passagère", () => {
    // Un format qu'Iris n'admet pas ne se réessaie pas ; un 429 ou un 502, si.
    for (const status of [400, 413, 415, 422]) {
      expect(isDefiniteUploadRefusal(status)).toBe(true);
    }
    for (const status of [401, 403, 429, 500, 502, 503]) {
      expect(isDefiniteUploadRefusal(status)).toBe(false);
    }
  });

  it("dit à l'agent POURQUOI une pièce n'est pas passée", () => {
    expect(uploadRefusalMessage(415, null)).toContain("format refusé");
    expect(uploadRefusalMessage(422, null)).toContain("extension");
    expect(uploadRefusalMessage(500, { error: { message: "Stockage indisponible." } }))
      .toBe("Stockage indisponible.");
  });

  it("ne signale rien quand toutes les pièces sont arrivées", () => {
    // Null ne vaut jamais « tout est arrivé » : les demandes déposées avant ce
    // chemin n'ont rien à en dire, elles ne doivent donc rien afficher.
    expect(attachmentsRefusedNote([])).toBeNull();
    expect(attachmentsRefusedNote([
      { fileName: "statuts.doc", fieldLabel: "Statuts de l'association", reason: "format refusé par Iris" },
    ])).toBe(
      "Pièce non transmise à Iris : Statuts de l'association — statuts.doc (format refusé par Iris).",
    );
  });
});
