import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emailTemplateMirrorRows,
  emailTemplatesWarning,
} from "../../../supabase/functions/sync-socle-referentiel/emailTemplates";

const ROOT = "d5227d25-f327-493a-a9a2-278397531e33";
const OTHER_ROOT = "11111111-2222-4333-8444-555555555555";
const SERVICE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TPL = "0f0e0d0c-0b0a-4908-8706-050403020100";

const created = {
  id: TPL,
  key: null,
  organization_id: ROOT,
  name: " Relance pièces manquantes ",
  description: "Quand un dossier est incomplet",
  subject: "Votre courrier {{demande.reference}}",
  body: "{{usager.salutation}},\n\nMerci.",
  applications: ["clara", "iris"],
  organization_ids: [SERVICE, ROOT, SERVICE, "pas-un-uuid"],
  is_system: false,
  updated_at: "2026-11-12T10:00:00Z",
};

describe("miroir des modèles de courriels (Socle → Clara)", () => {
  it("recopie un modèle créé coché pour Clara, organismes dédoublonnés et triés", () => {
    expect(emailTemplateMirrorRows(ROOT, [created])).toEqual([
      {
        socle_id: TPL,
        name: "Relance pièces manquantes",
        description: "Quand un dossier est incomplet",
        subject: "Votre courrier {{demande.reference}}",
        body: "{{usager.salutation}},\n\nMerci.",
        socle_organization_ids: [ROOT, SERVICE].sort(),
        socle_updated_at: "2026-11-12T10:00:00Z",
      },
    ]);
  });

  it("écarte les courriels système, les modèles d'Iris seul, d'une autre racine ou incomplets", () => {
    const rows = emailTemplateMirrorRows(ROOT, [
      { ...created, id: null, key: "accuse_reception", is_system: true, applications: ["iris", "clara"] },
      { ...created, applications: ["iris"] },
      { ...created, organization_id: OTHER_ROOT },
      { ...created, body: "   " },
      { ...created, id: "pas-un-uuid" },
      null,
    ]);
    expect(rows).toEqual([]);
  });

  it("garde un modèle proposé nulle part (liste vide), sans l'étendre aux services", () => {
    const rows = emailTemplateMirrorRows(ROOT, [{ ...created, organization_ids: [] }]);
    expect(rows?.[0].socle_organization_ids).toEqual([]);
  });

  it("une réponse qui n'est pas une liste rend null : le miroir n'est pas effacé", () => {
    expect(emailTemplateMirrorRows(ROOT, { error: "x" })).toBeNull();
    expect(emailTemplateMirrorRows(ROOT, [])).toEqual([]);
  });

  it("avertissements lisibles selon le statut", () => {
    expect(emailTemplatesWarning("ACCM", 404)).toMatch(/1\.45\.0/);
    expect(emailTemplatesWarning("ACCM", 403)).toMatch(/403/);
    expect(emailTemplatesWarning("ACCM", 500)).toMatch(/500 — miroir inchangé/);
  });

  it("la synchronisation appelle la route filtrée sur Clara et la RPC de service", () => {
    const src = readFileSync(
      join(__dirname, "../../../supabase/functions/sync-socle-referentiel/index.ts"),
      "utf8",
    );
    expect(src).toContain("/v1/email-templates?organization_id=");
    expect(src).toContain("&application=clara");
    expect(src).toContain('rpc("sync_email_templates_from_socle"');
  });
});
