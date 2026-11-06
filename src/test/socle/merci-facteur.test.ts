import { describe, expect, it } from "vitest";
import {
  MF_ADDRESS_KEYS,
  buildSendCourrierBody,
  bytesToBase64,
  decideOutcome,
  mfAntidoublon,
  mfErrorText,
  mfSignature,
  normalizeMfAddress,
  parseFreeTextAddress,
  readSendOk,
  resolveRecipientAddress,
  parseMfWebhook,
  mfEventLabel,
  safeEqual,
} from "../../../supabase/functions/_shared/merciFacteurLogic";

const DEST = normalizeMfAddress({ nom: "Martin", prenom: "Joël", adresse1: "33 allée de la Pâquerette", cp: "75015", ville: "Paris" });
const EXP = normalizeMfAddress({ societe: "Mairie de Rosny", adresse1: "1 place X", cp: "93110", ville: "Rosny-sous-Bois" });

describe("Merci Facteur — signature", () => {
  it("HMAC-SHA256 de serviceId + ts, clé secrète, en hexadécimal minuscule", async () => {
    expect(await mfSignature("abc123", "secret", 1757404800)).toBe(
      "5e24fa0d1fe05f90f4ef2b3d3bf3e99edc912faa079f5dc5a207626535071cc7",
    );
  });
});

describe("Merci Facteur — adresses", () => {
  it("garde les 11 clés, vides à \"\", pays FRANCE d'office", () => {
    expect(Object.keys(DEST).sort()).toEqual([...MF_ADDRESS_KEYS].sort());
    expect(DEST.societe).toBe("");
    expect(DEST.pays).toBe("FRANCE");
  });

  it("exige nom ou organisation, code postal et ville", () => {
    expect(() => normalizeMfAddress({ cp: "75015", ville: "Paris" })).toThrow(/nom ou organisation/);
    expect(() => normalizeMfAddress({ nom: "Martin", ville: "Paris" })).toThrow(/code postal/);
  });

  it("tronque aux limites et nettoie la référence", () => {
    const a = normalizeMfAddress({ nom: "x".repeat(100), cp: "75015", ville: "Paris", reference: "2026-E-00042 / réponse" });
    expect(a.nom).toHaveLength(70);
    expect(a.reference).toBe("2026-E-00042  rponse");
  });

  it("découpe une adresse en texte libre", () => {
    expect(parseFreeTextAddress("3 rue X, Bât. B, 27000 Évreux")).toEqual({
      adresse1: "3 rue X", adresse2: "Bât. B", adresse3: "", cp: "27000", ville: "Évreux",
    });
    expect(parseFreeTextAddress("12 avenue Y\n93110 Rosny-sous-Bois\nFrance")?.cp).toBe("93110");
    expect(parseFreeTextAddress("Évreux")).toBeNull();
    expect(parseFreeTextAddress("27000 Évreux")).toBeNull(); // pas de ligne d'adresse
    expect(parseFreeTextAddress(null)).toBeNull();
  });
});

describe("Merci Facteur — corps de sendCourrier", () => {
  const body = buildSendCourrierBody({
    idUser: "42", exp: EXP, dest: DEST, pdfBase64: "data:application/pdf;base64,QUJD\nREVG",
    mode: "recommande", designation: "2026-S-00012 Réponse à votre demande de stationnement", antidoublon: mfAntidoublon("c-1"),
    finalFilename: "reponse.pdf",
  });

  it("chaînes JSON, vides à \"\" et jamais [], base64 nettoyé", () => {
    const adress = JSON.parse(body.get("adress")!);
    expect(adress.exp.societe).toBe("Mairie de Rosny");
    expect(adress.dest).toHaveLength(1);
    const content = JSON.parse(body.get("content")!);
    expect(content).toEqual({
      letter: { files: "", base64files: ["QUJDREVG"], print_sides: "recto", final_filename: "reponse" },
      photo: "",
      card: "",
    });
  });

  it("type d'envoi, désignation tronquée, antidoublon stable", () => {
    expect(body.get("modeEnvoi")).toBe("lrar");
    expect(body.get("designation")).toHaveLength(50);
    expect(body.get("antidoublon")).toBe("clara-c-1");
    expect(body.has("dateEnvoi")).toBe(false);
    expect(mfAntidoublon("c-1")).toBe(mfAntidoublon("c-1"));
  });

  it("encode le base64 par tranches sans déborder", () => {
    const big = new Uint8Array(300_000).fill(65);
    expect(bytesToBase64(big).slice(0, 8)).toBe("QUFBQUFB");
  });
});

describe("Merci Facteur — réponses et issue", () => {
  it("lit envoi_id (tableau ou entier), prix et pages", () => {
    expect(readSendOk({ envoi_id: [123], price: { total: { ht: "1.10", ttc: "1.32" } }, resume: { nb_page: 2 } })).toEqual({
      envoiId: "123", priceHt: 1.1, priceTtc: 1.32, nbPages: 2,
    });
    expect(readSendOk({ envoi_id: 7 }).envoiId).toBe("7");
  });

  it("lit l'erreur, chaîne ou objet", () => {
    expect(mfErrorText("INFO_ADDRESS_MISSING")).toBe("INFO_ADDRESS_MISSING");
    expect(mfErrorText({ code: "INVALID_DATE_ENVOI", text: "Date invalide" })).toBe("INVALID_DATE_ENVOI — Date invalide");
  });

  it("parti, refusé, ou à vérifier", () => {
    expect(decideOutcome([{ kind: "ok", data: { envoi_id: [1] } }]).status).toBe("sent");
    expect(decideOutcome([{ kind: "refused", error: "X" }])).toEqual({ status: "failed", error: "X" });
    // Sans réponse puis accepté : l'antidoublon garantit qu'un seul courrier part.
    expect(decideOutcome([{ kind: "unknown", reason: "délai" }, { kind: "ok", data: {} }]).status).toBe("sent");
    // Sans réponse puis refusé : peut-être le doublon d'un envoi passé.
    expect(decideOutcome([{ kind: "unknown", reason: "délai" }, { kind: "refused", error: "X" }]).status).toBe("to_verify");
    expect(decideOutcome([{ kind: "unknown", reason: "a" }, { kind: "unknown", reason: "b" }]).status).toBe("to_verify");
  });
});

describe("Merci Facteur — adresse du destinataire", () => {
  const fiche = {
    contact_type: "personne", civility: "madame", first_name: "Anne", last_name: "Durand",
    address_line1: "5 rue Z", address_line2: "Apt 3", postal_code: "27000", city: "Évreux", country: "FR",
  };

  it("préfère la fiche du Socle, avec la civilité", () => {
    const a = resolveRecipientAddress(fiche, { address: "1 rue ancienne, 75001 Paris" }, "2026-S-00012");
    expect(a).toMatchObject({ civilite: "Madame", nom: "Durand", prenom: "Anne", adresse1: "5 rue Z", adresse2: "Apt 3", cp: "27000", ville: "Évreux", pays: "FRANCE", reference: "2026-S-00012" });
  });

  it("une personne morale part au nom de l'organisation", () => {
    const a = resolveRecipientAddress({ ...fiche, contact_type: "entreprise", legal_name: "ACME SAS", first_name: null, last_name: null }, null, "r");
    expect(a.societe).toBe("ACME SAS");
  });

  it("à défaut, l'instantané décomposé puis le texte libre du participant", () => {
    expect(resolveRecipientAddress(null, { name: "Jean Martin", metadata: { address_line1: "8 bd Q", postal_code: "93110", city: "Rosny" } }, "r").adresse1).toBe("8 bd Q");
    const free = resolveRecipientAddress(null, { first_name: "Jean", last_name: "Martin", address: "8 bd Q, 93110 Rosny" }, "r");
    expect(free).toMatchObject({ nom: "Martin", cp: "93110", ville: "Rosny" });
  });

  it("refuse une adresse absente ou étrangère, avec un message pour l'agent", () => {
    expect(() => resolveRecipientAddress(null, { name: "Jean", address: "Rosny" }, "r")).toThrow(/introuvable ou incomplète/);
    expect(() => resolveRecipientAddress({ ...fiche, country: "BE" }, null, "r")).toThrow(/hors de France/);
  });
});

describe("Merci Facteur — webhook", () => {
  it("lit les champs en objet ou en chaîne JSON", () => {
    const w = parseMfWebhook({
      event: JSON.stringify({ type: "npai", id_user: 1, date: "2026-11-10 10:00:00" }),
      detail: JSON.stringify([{ id_envoi: 123, ref_courrier: "C1", statut: "NPAI" }, { foo: 1 }]),
    });
    expect(w).toEqual({ eventType: "npai", eventDate: "2026-11-10 10:00:00", items: [{ envoiId: "123", refCourrier: "C1", status: "NPAI" }] });
    expect(parseMfWebhook({ event: "imprime", detail: { idEnvoi: 9 } })?.items[0].envoiId).toBe("9");
  });

  it("refuse un webhook sans courrier reconnaissable", () => {
    expect(parseMfWebhook({ event: "x", detail: [] })).toBeNull();
    expect(parseMfWebhook({})).toBeNull();
  });

  it("nomme les événements connus, garde les autres", () => {
    expect(mfEventLabel("npai")).toBe("Non distribué (NPAI)");
    expect(mfEventLabel("ar_signe")).toBe("Accusé de réception signé");
    expect(mfEventLabel("distribue")).toBe("Distribué");
    expect(mfEventLabel("imprime")).toBe("Courrier imprimé");
    expect(mfEventLabel("evenement_inconnu")).toBe("evenement_inconnu");
  });

  it("compare le jeton à temps constant", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
