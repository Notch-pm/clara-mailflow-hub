// Types partagés du parcours d'import en masse. Historiquement dupliqués dans
// chaque étape du wizard — centralisés ici, source de vérité unique.

import type { SocleContact } from "@/services/socleContactService";
import type {
  SenderCivility,
  SenderIdentity,
  SenderMatch,
} from "../../../../supabase/functions/_shared/senderMatchLogic";

export interface BulkFile {
  id: string;
  file: File;
  previewUrl: string;
  groupId: number | null;
  rejected: boolean;
  rejectReason?: string;
}

export type DraftFlag = "missing-service" | "missing-civility" | "duplicate";

/**
 * Choix de l'agent sur le rapprochement de l'expéditeur :
 * - `auto` : la règle de `senderMatchLogic` s'applique (contact reconnu
 *   rattaché, sinon création) ;
 * - `use` : rattacher le contact proposé (nom proche confirmé) ;
 * - `create` : écarter le contact reconnu et créer une nouvelle fiche.
 */
export type SenderDecision = "auto" | "use" | "create";

export interface DraftCourier {
  id: string;
  title: string;
  senderCivility: SenderCivility | "";
  senderFirstName: string;
  senderLastName: string;
  senderEmail: string;
  senderPhone: string;
  /** Rapprochement Socle de l'expéditeur ; `null` = pas encore fait, ou périmé par une saisie. */
  senderMatch: SenderMatch<SocleContact> | null;
  senderDecision: SenderDecision;
  recipientName: string;
  serviceId: string;
  serviceName: string;
  tags: string[];
  bodyText: string;
  fileIds: string[];
  confidence: number;
  flags: DraftFlag[];
}

export function emptyDraft(fileIds: string[] = []): DraftCourier {
  return {
    id: crypto.randomUUID(),
    title: "",
    senderCivility: "",
    senderFirstName: "",
    senderLastName: "",
    senderEmail: "",
    senderPhone: "",
    senderMatch: null,
    senderDecision: "auto",
    recipientName: "",
    serviceId: "",
    serviceName: "",
    tags: [],
    bodyText: "",
    fileIds,
    confidence: 0,
    flags: ["missing-service"],
  };
}

export function draftSender(d: DraftCourier): SenderIdentity {
  return {
    first_name: d.senderFirstName.trim() || null,
    last_name: d.senderLastName.trim() || null,
    email: d.senderEmail.trim() || null,
    phone: d.senderPhone.trim() || null,
  };
}

export function hasSender(d: DraftCourier): boolean {
  return !!(d.senderFirstName.trim() || d.senderLastName.trim() || d.senderEmail.trim() || d.senderPhone.trim());
}

/** Contact du référentiel qui sera rattaché comme expéditeur, selon la règle et le choix de l'agent. */
export function linkedSenderContact(d: DraftCourier): SocleContact | null {
  const m = d.senderMatch;
  if (!m?.contact || d.senderDecision === "create") return null;
  if (d.senderDecision === "use") return m.contact;
  return m.status === "matched" ? m.contact : null;
}

/** Une fiche devra être créée dans le référentiel à la confirmation. */
export function senderNeedsCreation(d: DraftCourier): boolean {
  return hasSender(d) && !linkedSenderContact(d);
}

/** Recalcule les signalements de chaque brouillon (dépendent aussi des autres lignes). */
export function refreshFlags(drafts: DraftCourier[]): DraftCourier[] {
  return drafts.map((d) => {
    const flags: DraftFlag[] = [];
    if (!d.serviceName) flags.push("missing-service");
    // Le Socle refuse une personne sans civilité.
    if (senderNeedsCreation(d) && !d.senderCivility) flags.push("missing-civility");
    const title = d.title.trim();
    if (title && drafts.some((x) => x.id !== d.id && x.title.trim() === title)) flags.push("duplicate");
    return { ...d, flags };
  });
}

export function getGroupIds(files: BulkFile[]): number[] {
  const ids = new Set<number>();
  files.forEach((f) => { if (f.groupId !== null && !f.rejected) ids.add(f.groupId); });
  return Array.from(ids).sort((a, b) => a - b);
}

export function nextGroupId(files: BulkFile[]): number {
  const ids = getGroupIds(files);
  return ids.length === 0 ? 1 : Math.max(...ids) + 1;
}
