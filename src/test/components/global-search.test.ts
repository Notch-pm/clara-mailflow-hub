import { describe, it, expect } from "vitest";
import {
  buildGroups,
  flattenResults,
  isSearchable,
  MIN_QUERY_LENGTH,
  moveIndex,
  normalizeQuery,
  toCourierResult,
  toUsagerResult,
  type CourierResult,
  type UsagerResult,
} from "@/components/search/global-search";
import type { CourierListRow } from "@/services/courierListService";
import type { SocleContact } from "@/services/socleContactService";

/** Ligne de courrier minimale — seules les colonnes lues par la barre comptent. */
function courier(over: Partial<CourierListRow> = {}): CourierListRow {
  return {
    id: "c-1",
    subject: "Demande de raccordement",
    direction: "inbound",
    chrono: "2026-000042",
    received_at: "2026-08-12T09:00:00Z",
    sent_at: null,
    created_at: "2026-08-12T09:00:00Z",
    updated_at: "2026-08-12T09:00:00Z",
    workflow_state_id: "st-1",
    assigned_service: "Urbanisme",
    sender_name: "Dupont Marie",
    sender_first_name: null,
    sender_last_name: null,
    match_in: ["subject"],
    ...over,
  } as CourierListRow;
}

function contact(over: Partial<SocleContact> = {}): SocleContact {
  return {
    id: "u-1",
    contact_type: "personne",
    display_name: "Dupont Marie",
    city: "Nanterre",
    email: "marie.dupont@example.fr",
    ...over,
  } as SocleContact;
}

const STATES = new Map([
  ["st-1", { name: "En instruction", category: "processing" as const }],
  ["st-2", { name: "Archivé", category: "archived" as const }],
]);
const stateOf = (id: string) => STATES.get(id);

describe("normalizeQuery / isSearchable", () => {
  it("taille la saisie et recolle les espaces internes", () => {
    expect(normalizeQuery("  rue   des   lilas ")).toBe("rue des lilas");
  });

  it("ne cherche pas en deçà du seuil, espaces exclus", () => {
    expect(MIN_QUERY_LENGTH).toBe(3);
    expect(isSearchable("ab")).toBe(false);
    expect(isSearchable("  ab  ")).toBe(false);
    expect(isSearchable("abc")).toBe(true);
  });
});

describe("toCourierResult", () => {
  it("compose la ligne affichée d'un courrier instruit", () => {
    const r = toCourierResult(courier(), stateOf);
    expect(r).toMatchObject({
      kind: "courrier",
      href: "/courrier/c-1",
      chrono: "2026-000042",
      subject: "Demande de raccordement",
      direction: "Entrant",
      stateLabel: "En instruction",
      stateTone: "warning",
      sender: "Dupont Marie",
      service: "Urbanisme",
      matchIn: ["objet"],
    });
    expect(r.date).toBe("12/08/2026");
  });

  it("un courrier sans état ne porte pas de libellé — pas un état « inconnu »", () => {
    const r = toCourierResult(courier({ workflow_state_id: null }), stateOf);
    expect(r.stateLabel).toBe("");
  });

  it("l'archivé prend la teinte muette, comme dans les listes", () => {
    expect(toCourierResult(courier({ workflow_state_id: "st-2" }), stateOf).stateTone).toBe("muted");
  });

  it("recompose l'expéditeur depuis nom + prénom quand le nom composé manque", () => {
    const r = toCourierResult(
      courier({ sender_name: null, sender_last_name: "Benali", sender_first_name: "Karim" }),
      stateOf,
    );
    expect(r.sender).toBe("Benali Karim");
  });

  it("nomme les trous plutôt que de les laisser vides", () => {
    const r = toCourierResult(
      courier({ subject: "   ", sender_name: null, assigned_service: null }),
      stateOf,
    );
    expect(r.subject).toBe("(sans objet)");
    expect(r.sender).toBe("Expéditeur inconnu");
    expect(r.service).toBe("—");
  });

  it("un sortant se date sur l'envoi", () => {
    const r = toCourierResult(
      courier({ direction: "outbound", received_at: null, sent_at: "2026-09-01T10:00:00Z" }),
      stateOf,
    );
    expect(r.direction).toBe("Sortant");
    expect(r.date).toBe("01/09/2026");
  });
});

describe("toUsagerResult", () => {
  it("pointe vers la fiche du référentiel", () => {
    expect(toUsagerResult(contact())).toMatchObject({
      kind: "usager",
      href: "/contacts/u-1",
      name: "Dupont Marie",
      typeLabel: "Personne",
      city: "Nanterre",
      email: "marie.dupont@example.fr",
    });
  });

  it("une fiche sans nom ni ville reste affichable", () => {
    const r = toUsagerResult(contact({ display_name: null, city: null, email: null }));
    expect(r.name).toBe("Sans nom");
    expect(r.city).toBe("");
    expect(r.email).toBe("");
  });
});

describe("buildGroups", () => {
  it("met les courriers avant les usagers", () => {
    const groups = buildGroups([courier()], [contact()], stateOf);
    expect(groups.map((g) => g.key)).toEqual(["courriers", "usagers"]);
  });

  it("n'affiche pas un groupe vide — un en-tête sans ligne ferait croire à une attente", () => {
    expect(buildGroups([], [contact()], stateOf).map((g) => g.key)).toEqual(["usagers"]);
    expect(buildGroups([courier()], [], stateOf).map((g) => g.key)).toEqual(["courriers"]);
    expect(buildGroups([], [], stateOf)).toEqual([]);
  });

  it("le parcours au clavier suit les groupes mis bout à bout", () => {
    const groups = buildGroups([courier(), courier({ id: "c-2" })], [contact()], stateOf);
    const flat = flattenResults(groups);
    expect(flat.map((r) => r.kind)).toEqual(["courrier", "courrier", "usager"]);
    expect((flat[2] as UsagerResult).id).toBe("u-1");
    expect((flat[0] as CourierResult).id).toBe("c-1");
  });
});

describe("moveIndex", () => {
  it("boucle dans les deux sens", () => {
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(0, 1, 3)).toBe(1);
  });

  it("une liste vide n'a aucun index à retenir", () => {
    expect(moveIndex(0, 1, 0)).toBe(0);
  });
});
