import { describe, expect, it } from "vitest";
import {
  addressLines,
  defaultChannel,
  emailBlocker,
  formatPostedAt,
  nowTimeIso,
  postalBlocker,
  postalModeLabel,
  postDeclarationError,
  postedAtIso,
  todayIso,
} from "@/lib/outbound-channel";
import {
  issuerBlockReason,
  noReplyWorkflowReason,
  obsoleteIssuerReason,
  NO_ISSUER_REASON,
  POSTED_DATE_REASON,
  POSTED_MODE_REASON,
  POSTED_TIME_REQUIRED_REASON,
} from "../../../supabase/functions/_shared/outboundInitiativeGuard";

const FULL = { email: "a@b.fr", address_line1: "3 rue X", postal_code: "27000", city: "Évreux" };

describe("defaultChannel", () => {
  it("suit le canal préféré de l'usager s'il est praticable", () => {
    expect(defaultChannel({ ...FULL, preferred_channel: "courrier" })).toBe("paper");
    expect(defaultChannel({ ...FULL, preferred_channel: "email" })).toBe("email");
  });

  it("préférence courriel sans adresse électronique : le courrier", () => {
    expect(defaultChannel({ ...FULL, email: null, preferred_channel: "email" })).toBe("paper");
  });

  it("sans préférence : le courriel s'il y a une adresse, sinon le courrier", () => {
    expect(defaultChannel({ ...FULL, preferred_channel: null })).toBe("email");
    expect(defaultChannel({ ...FULL, email: "  " })).toBe("paper");
    expect(defaultChannel(null)).toBe("paper");
  });
});

describe("emailBlocker / postalBlocker", () => {
  it("le courriel exige une adresse électronique", () => {
    expect(emailBlocker(FULL)).toBeNull();
    expect(emailBlocker({ email: null })).toMatch(/adresse électronique/);
  });

  it("le courrier exige adresse, code postal et ville, et dit ce qui manque", () => {
    expect(postalBlocker(FULL)).toBeNull();
    expect(postalBlocker({ ...FULL, postal_code: null })).toBe("Adresse postale incomplète : il manque le code postal.");
    expect(postalBlocker({})).toBe(
      "Adresse postale incomplète : il manque l'adresse, le code postal et la ville.",
    );
  });

  it("le pavé d'adresse retire les lignes vides", () => {
    expect(addressLines({ ...FULL, address_line2: "" })).toEqual(["3 rue X", "27000 Évreux"]);
    expect(addressLines(null)).toEqual([]);
  });
});

describe("issuerBlockReason — mêmes messages que la base", () => {
  it("une organisation active avec workflow de réponse peut émettre", () => {
    expect(issuerBlockReason({ name: "Cabinet", reply_workflow_id: "wf", status: "active", obsoleted_at: null })).toBeNull();
  });

  it("sans workflow de réponse, on nomme l'organisation", () => {
    expect(issuerBlockReason({ name: "Culture", reply_workflow_id: null })).toBe(noReplyWorkflowReason("Culture"));
    expect(noReplyWorkflowReason("Culture")).toBe(
      "Aucun workflow de réponse n'est configuré pour l'organisation « Culture ». Un administrateur doit le rattacher.",
    );
  });

  it("obsolète ou absente", () => {
    expect(issuerBlockReason({ name: "Ancienne", reply_workflow_id: "wf", status: "obsolete" })).toBe(
      obsoleteIssuerReason("Ancienne"),
    );
    expect(issuerBlockReason(null)).toBe(NO_ISSUER_REASON);
  });
});

describe("déclaration d'envoi postal", () => {
  const now = new Date(2026, 10, 6, 14, 30); // 6 nov. 2026, 14:30 locale
  const created = new Date(2026, 10, 6, 9, 15, 42).toISOString();
  const ok = { date: "2026-11-06", time: "14:30", mode: "simple" as const };

  it("propose maintenant, à la minute, en heure locale", () => {
    expect(todayIso(now)).toBe("2026-11-06");
    expect(nowTimeIso(now)).toBe("14:30");
  });

  it("convertit la date et l'heure locales en horodatage ISO", () => {
    expect(postedAtIso("2026-11-06", "14:30")).toBe(new Date(2026, 10, 6, 14, 30).toISOString());
    expect(postedAtIso("2026-11-06", "")).toBeNull();
    expect(postedAtIso("", "14:30")).toBeNull();
  });

  it("accepte maintenant, en simple comme en recommandé", () => {
    expect(postDeclarationError(ok, created, now)).toBeNull();
    expect(postDeclarationError({ ...ok, mode: "recommande" }, created, now)).toBeNull();
    // La minute de création elle-même est permise.
    expect(postDeclarationError({ ...ok, time: "09:15" }, created, now)).toBeNull();
  });

  it("exige la date, l'heure et le type d'envoi", () => {
    expect(postDeclarationError({ ...ok, time: "" }, created, now)).toBe(POSTED_TIME_REQUIRED_REASON);
    expect(postDeclarationError({ ...ok, date: "" }, created, now)).toBe(POSTED_TIME_REQUIRED_REASON);
    expect(postDeclarationError({ ...ok, mode: null }, created, now)).toBe(POSTED_MODE_REASON);
  });

  it("refuse le futur et l'avant-création", () => {
    expect(postDeclarationError({ ...ok, time: "14:35" }, created, now)).toBe(POSTED_DATE_REASON);
    expect(postDeclarationError({ ...ok, time: "09:14" }, created, now)).toBe(POSTED_DATE_REASON);
  });

  it("affiche date et heure, et la date seule d'une ancienne déclaration", () => {
    expect(formatPostedAt(new Date(2026, 10, 6, 14, 5).toISOString())).toBe("06/11/2026 à 14:05");
    expect(formatPostedAt("2026-10-13")).toBe("13/10/2026");
    expect(postalModeLabel("recommande")).toBe("Recommandé");
    expect(postalModeLabel(undefined)).toBeNull();
  });
});
