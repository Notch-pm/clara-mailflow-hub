import { describe, expect, it } from "vitest";
import { addressLines, defaultChannel, emailBlocker, postalBlocker } from "@/lib/outbound-channel";
import {
  issuerBlockReason,
  noReplyWorkflowReason,
  obsoleteIssuerReason,
  NO_ISSUER_REASON,
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
