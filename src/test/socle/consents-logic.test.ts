import { describe, expect, it } from "vitest";
import {
  buildConsentsFromCourierBody,
  buildConsentsRecordBody,
  CONSENT_SOURCE_APP,
} from "../../../supabase/functions/_shared/consentsLogic";
import { consentStatement } from "../../../supabase/functions/_shared/consents/catalog";

const NOW = new Date("2026-09-22T10:00:00.000Z");

// `strict: false` : pas de rétrécissement par discriminant, on lit à plat.
const messageOf = (r: unknown) => (r as { message?: string }).message ?? "";

describe("buildConsentsRecordBody — consignation manuelle par un agent", () => {
  it("compose la phrase depuis le nom de l'organisation, jamais depuis le client", () => {
    const res = buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }, { kind: "partage", granted: false }] },
      "Ville d'Arles",
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body).toEqual({
      source_app: CONSENT_SOURCE_APP,
      source_reference: null,
      collected_at: "2026-09-22T10:00:00.000Z",
      consents: [
        { kind: "traitement", granted: true, statement: consentStatement("traitement") },
        { kind: "partage", granted: false, statement: consentStatement("partage", "Ville d'Arles") },
      ],
    });
    expect(res.body.consents[1].statement).toContain("aux services de Ville d'Arles");
  });

  it("se replie sur « la collectivité » sans nom, plutôt qu'une phrase à trou", () => {
    const res = buildConsentsRecordBody({ answers: [{ kind: "partage", granted: true }] }, null, NOW);
    expect(res.ok && res.body.consents[0].statement).toContain("aux services de la collectivité");
  });

  it("refuse un libellé venu du navigateur, au niveau du payload comme d'une réponse", () => {
    const top = buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }], statement: "je signe" }, "A", NOW);
    expect(top.ok).toBe(false);
    expect(messageOf(top)).toContain("composé par le serveur");
    const inner = buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true, statement: "je signe" }] }, "A", NOW);
    expect(inner.ok).toBe(false);
    expect(messageOf(inner)).toContain("composé par le serveur");
  });

  it("accepte un retrait de l'obligatoire : le Socle enregistre un fait", () => {
    const res = buildConsentsRecordBody({ answers: [{ kind: "traitement", granted: false }] }, "A", NOW);
    expect(res.ok && res.body.consents).toEqual([
      { kind: "traitement", granted: false, statement: consentStatement("traitement") },
    ]);
  });

  it("ne répond que ce qui a été répondu, dans l'ordre du catalogue", () => {
    const res = buildConsentsRecordBody(
      { answers: [{ kind: "partage", granted: false }, { kind: "traitement", granted: true }] }, "A", NOW);
    expect(res.ok && res.body.consents.map((c) => c.kind)).toEqual(["traitement", "partage"]);
    const seul = buildConsentsRecordBody({ answers: [{ kind: "partage", granted: false }] }, "A", NOW);
    expect(seul.ok && seul.body.consents).toHaveLength(1);
  });

  it("date du recueil : défaut maintenant, antérieure acceptée, future refusée, illisible refusée", () => {
    const defaut = buildConsentsRecordBody({ answers: [{ kind: "traitement", granted: true }] }, "A", NOW);
    expect(defaut.ok && defaut.body.collected_at).toBe(NOW.toISOString());

    const papier = buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }], collected_at: "2026-09-01T08:00:00+02:00" }, "A", NOW);
    expect(papier.ok && papier.body.collected_at).toBe("2026-09-01T06:00:00.000Z");

    const future = buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }], collected_at: "2026-09-23T00:00:00Z" }, "A", NOW);
    expect(future.ok).toBe(false);
    expect(messageOf(future)).toContain("future");

    expect(buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }], collected_at: "hier" }, "A", NOW).ok).toBe(false);
  });

  it("référence : vide → null (fait nouveau à chaque appel), sinon trim, bornée à 200", () => {
    const vide = buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }], reference: "   " }, "A", NOW);
    expect(vide.ok && vide.body.source_reference).toBeNull();
    const chrono = buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }], reference: "  2026-00412 " }, "A", NOW);
    expect(chrono.ok && chrono.body.source_reference).toBe("2026-00412");
    expect(buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }], reference: "x".repeat(201) }, "A", NOW).ok).toBe(false);
  });

  it("refuse une forme invalide, un type hors catalogue et un doublon", () => {
    expect(buildConsentsRecordBody(undefined, "A", NOW).ok).toBe(false);
    expect(buildConsentsRecordBody({ answers: [] }, "A", NOW).ok).toBe(false);
    expect(buildConsentsRecordBody({ answers: [null] }, "A", NOW).ok).toBe(false);
    expect(buildConsentsRecordBody({ answers: [{ kind: "newsletter", granted: true }] }, "A", NOW).ok).toBe(false);
    expect(buildConsentsRecordBody({ answers: [{ kind: "traitement", granted: "oui" }] }, "A", NOW).ok).toBe(false);
    expect(buildConsentsRecordBody(
      { answers: [{ kind: "traitement", granted: true }, { kind: "traitement", granted: true }] }, "A", NOW).ok).toBe(false);
    expect(buildConsentsRecordBody({ answers: [{ kind: "traitement", granted: true }], courier_id: "x" }, "A", NOW).ok).toBe(false);
  });
});

describe("buildConsentsFromCourierBody — report de la trace d'un dépôt portail", () => {
  const trace = [
    { kind: "traitement", granted: true, statement: "Phrase lue au dépôt.", collected_at: "2026-09-20T08:00:00.000Z" },
    { kind: "partage", granted: false, statement: "Phrase de partage lue au dépôt.", collected_at: "2026-09-20T08:00:00.000Z" },
  ];
  const courier = {
    id: "11111111-1111-1111-1111-111111111111",
    received_at: "2026-09-20T08:00:00+00:00",
    created_at: "2026-09-20T08:00:01+00:00",
    consents: trace,
  };

  it("porte l'id du courrier en référence et reprend les phrases TELLES QUELLES", () => {
    const res = buildConsentsFromCourierBody(courier);
    expect(res.ok).toBe(true);
    if (!res.ok || !res.body) return;
    expect(res.body.source_app).toBe("clara");
    expect(res.body.source_reference).toBe(courier.id);
    expect(res.body.consents).toEqual([
      { kind: "traitement", granted: true, statement: "Phrase lue au dépôt." },
      { kind: "partage", granted: false, statement: "Phrase de partage lue au dépôt." },
    ]);
    // Aucun `collected_at` par élément : le Socle n'accepte que kind/granted/statement.
    for (const c of res.body.consents) expect(c).not.toHaveProperty("collected_at");
  });

  it("date : celle de la trace, sinon la réception, sinon la création — jamais « maintenant »", () => {
    expect(buildConsentsFromCourierBody(courier).ok && (buildConsentsFromCourierBody(courier) as { body: { collected_at: string } }).body.collected_at)
      .toBe("2026-09-20T08:00:00.000Z");
    const sansDate = buildConsentsFromCourierBody({
      ...courier, consents: trace.map(({ collected_at: _c, ...rest }) => rest),
    });
    expect(sansDate.ok && sansDate.body?.collected_at).toBe("2026-09-20T08:00:00.000Z");
    const creation = buildConsentsFromCourierBody({
      ...courier, received_at: null, consents: trace.map(({ collected_at: _c, ...rest }) => rest),
    });
    expect(creation.ok && creation.body?.collected_at).toBe("2026-09-20T08:00:01.000Z");
  });

  it("rend body null quand le courrier n'a pas de trace : rien à reporter, pas une erreur", () => {
    for (const consents of [[], null, undefined, "oui", [{ kind: "newsletter", granted: true }]]) {
      const res = buildConsentsFromCourierBody({ ...courier, consents });
      expect(res).toEqual({ ok: true, body: null });
    }
  });
});
