import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Check, ChevronsUpDown, X, User, FileText, Building2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  listProcedureActivations,
  listProcedures,
  type ArpegeConfigField,
  type ArpegeFormComponent,
} from "@/services/procedureService";
import { listSocleOrganizationTree } from "@/services/socleSyncService";
import { buildSocleOrgTree, flattenSocleOrgTree } from "@/lib/socleOrgTree";
import {
  buildActivationIndex,
  filterProceduresForOrganization,
  isProcedureOfferedBy,
} from "@/lib/procedure-activation";
import {
  isPartnerSuspended,
  isRequestableProcedure,
  procedureOrigin,
  procedureOriginLabel,
} from "@/lib/procedure-origin";
import { getPartnerIntegrationStatus } from "@/services/partnerIntegrationService";
import { createTicket, createArpegeTicket } from "@/services/actionTicketService";
import { pushIrisRequest } from "@/services/irisRequestService";
import { logEvent } from "@/services/courierEventService";
import { getDocuments } from "@/services/courierDocumentService";
import { getParticipants } from "@/services/courierParticipantService";
import { getContact, type SocleContact } from "@/services/socleContactService";
import PiecesJointesField from "./PiecesJointesField";
import { SocleFormFields, SocleRequesterForm } from "./SocleDemandeForm";
import {
  buildSocleDemandeData,
  enabledAudiences,
  formRequiredMet,
  parseFormSchema,
  parseRequesterConfig,
  requesterRequiredMet,
  type Audience,
  type FormValues,
} from "@/lib/socle-form";
import {
  applySocleFormPrefill,
  arpegePrefillToSocleRequester,
  contactToArpegeValues,
  contactToSocleRequester,
  contactTypeToAudience,
  mergeNonEmpty,
  resolveAudience,
  type SenderParticipantLike,
  type SoclePrefill,
} from "@/lib/prefill-mapping";
import type { CourierDocument } from "@/types/courier";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courierId: string;
  organizationId: string;
  initialProcedureId?: string;
  initialArpegeValues?: Record<string, string>;
  /** Préremplissage Socle de l'action suggérée (audience + valeurs par clé). */
  initialSoclePrefill?: SoclePrefill | null;
  /** Préremplissage du formulaire métier Arpège de l'action suggérée (valeurs par DataId). */
  initialArpegePrefill?: Record<string, string> | null;
  /** Organisation destinataire suggérée par l'analyse IA (id du miroir Socle). */
  initialSocleOrganizationId?: string | null;
  /** Organisation gestionnaire du courrier — destinataire par défaut de la demande. */
  courierSocleOrganizationId?: string | null;
}

const CIVILITE_OPTIONS = [
  { value: "M", label: "M." },
  { value: "MME", label: "Mme" },
  { value: "MLLE", label: "Mlle" },
];

const FIELD_CODES_DISPLAYED = [
  "CIVILITE", "NOM_USUEL", "NOM_NAISSANCE", "PRENOMS",
  "DATE_NAISSANCE", "EMAIL", "TEL_FIXE", "TEL_MOBILE",
];

const DEMANDEUR_FULL_WIDTH = new Set(["PRENOMS", "EMAIL"]);

// ── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-2 pb-1">
      <div className="mt-0.5 rounded-md bg-muted p-1.5">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm font-semibold leading-tight">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

// ── Demandeur form (2-column grid) ──────────────────────────────────────────

function ArpegeForm({
  fields,
  values,
  onChange,
}: {
  fields: ArpegeConfigField[];
  values: Record<string, string>;
  onChange: (code: string, value: string) => void;
}) {
  const visible = fields.filter((f) => FIELD_CODES_DISPLAYED.includes(f.Code));

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      {visible.map((field) => {
        const val = values[field.Code] ?? "";
        const fullWidth = DEMANDEUR_FULL_WIDTH.has(field.Code);

        const labelEl = (
          <Label htmlFor={`arpege-${field.Code}`} className="text-xs text-muted-foreground">
            {field.Intitule}
            {field.Obligatoire && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        );

        let input: React.ReactNode;

        if (field.Code === "CIVILITE") {
          input = (
            <Select value={val} onValueChange={(v) => onChange(field.Code, v)}>
              <SelectTrigger id={`arpege-${field.Code}`} className="h-8 text-sm">
                <SelectValue placeholder="Sélectionner…" />
              </SelectTrigger>
              <SelectContent>
                {CIVILITE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        } else if (field.Code === "DATE_NAISSANCE") {
          input = <Input id={`arpege-${field.Code}`} type="date" className="h-8 text-sm"
            value={val} onChange={(e) => onChange(field.Code, e.target.value)} />;
        } else if (field.Code === "EMAIL") {
          input = <Input id={`arpege-${field.Code}`} type="email" className="h-8 text-sm"
            value={val} onChange={(e) => onChange(field.Code, e.target.value)} />;
        } else if (field.Code === "TEL_FIXE" || field.Code === "TEL_MOBILE") {
          input = <Input id={`arpege-${field.Code}`} type="tel" className="h-8 text-sm"
            value={val} onChange={(e) => onChange(field.Code, e.target.value)} />;
        } else {
          input = <Input id={`arpege-${field.Code}`} className="h-8 text-sm"
            value={val} onChange={(e) => onChange(field.Code, e.target.value)} />;
        }

        return (
          <div key={field.Code} className={cn("space-y-1", fullWidth && "col-span-2")}>
            {labelEl}
            {input}
          </div>
        );
      })}
    </div>
  );
}

// ── Business form (FormComponents, 2-column grid) ───────────────────────────

interface FlatComponent {
  component: ArpegeFormComponent;
  groupLabel?: string;
}

function flattenComponents(
  components: ArpegeFormComponent[],
  groupLabel?: string,
): FlatComponent[] {
  const result: FlatComponent[] = [];
  // If this level contains a Pieces_jointes, sibling leaf fields are auxiliary
  // (e.g. a title/description Texte added by Arpège alongside the upload slot)
  // and should be skipped to avoid spurious text inputs.
  const levelHasPJ = components.some((c) => c.Type === "Pieces_jointes");

  for (const c of components) {
    if (c.Type === "Bloc") {
      result.push(...flattenComponents(c.Components ?? [], c.Libelle || groupLabel));
    } else if (c.Type === "Pieces_jointes") {
      result.push({ component: c, groupLabel });
    } else if (!levelHasPJ && c.Type !== "Label_long") {
      result.push({ component: c, groupLabel });
    }
  }
  return result;
}

function isRequired(c: ArpegeFormComponent): boolean {
  return !c.Libelle?.includes("(facultatif)");
}

function getOptions(c: ArpegeFormComponent): Array<{ code: string; label: string }> {
  if (!Array.isArray(c.Value) || c.Value.length === 0) return [];
  return (c.Value as Array<Record<string, string>>).map((v) => ({
    code: v.Code ?? v.code ?? String(v),
    label: v.Libelle ?? v.libelle ?? v.Label ?? v.Code ?? String(v),
  }));
}

const FULL_WIDTH_TYPES = new Set(["Identite", "Pieces_jointes"]);

type IdentiteValue = {
  CodeCivilite: string;
  NomUsage: string;
  NomNaissance: string;
  Prenoms: string;
};

function ArpegeBusinessForm({
  components,
  values,
  onChange,
  courierDocs,
  piecesJointes,
  onTogglePieceJointe,
  onNewDoc,
  orgId,
  courierId,
}: {
  components: ArpegeFormComponent[];
  values: Record<string, unknown>;
  onChange: (dataId: string, value: unknown) => void;
  courierDocs: CourierDocument[];
  piecesJointes: Record<string, string[]>;
  onTogglePieceJointe: (dataId: string, docId: string) => void;
  onNewDoc: (dataId: string, doc: CourierDocument) => void;
  orgId: string;
  courierId: string;
}) {
  const flat = flattenComponents(components);
  if (flat.length === 0) return null;

  const groups: Array<{ label?: string; items: FlatComponent[] }> = [];
  for (const item of flat) {
    const last = groups[groups.length - 1];
    if (!last || last.label !== item.groupLabel) {
      groups.push({ label: item.groupLabel, items: [item] });
    } else {
      last.items.push(item);
    }
  }

  return (
    <div className="space-y-4">
      {groups.map((group, gi) => (
        <div key={gi} className="space-y-2">
          {group.label && (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1">
              {group.label}
            </p>
          )}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {group.items.map(({ component: c }) => {
              const required = isRequired(c);
              const fullWidth = FULL_WIDTH_TYPES.has(c.Type);

              const labelEl = (
                <Label htmlFor={`biz-${c.DataId}`} className="text-xs text-muted-foreground">
                  {c.Libelle}
                  {required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
              );
              const helpEl = c.LibelleAide ? (
                <p className="text-[10px] text-muted-foreground/70 -mt-0.5">{c.LibelleAide}</p>
              ) : null;

              // ── Pieces jointes ──
              if (c.Type === "Pieces_jointes") {
                return (
                  <div key={c.DataId} className="col-span-2">
                    <PiecesJointesField
                      label={c.Libelle}
                      required={required}
                      helpText={c.LibelleAide || undefined}
                      courierDocs={courierDocs}
                      selectedIds={piecesJointes[c.DataId] ?? []}
                      onToggle={(id) => onTogglePieceJointe(c.DataId, id)}
                      orgId={orgId}
                      courierId={courierId}
                      onNewDoc={(doc) => onNewDoc(c.DataId, doc)}
                    />
                  </div>
                );
              }

              // ── Identite ──
              if (c.Type === "Identite") {
                const identVal = (values[c.DataId] as IdentiteValue) ?? {
                  CodeCivilite: "", NomUsage: "", NomNaissance: "", Prenoms: "",
                };
                const update = (key: keyof IdentiteValue, v: string) =>
                  onChange(c.DataId, { ...identVal, [key]: v });
                return (
                  <div key={c.DataId} className={cn("space-y-1.5", fullWidth && "col-span-2")}>
                    {labelEl}
                    {helpEl}
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={identVal.CodeCivilite} onValueChange={(v) => update("CodeCivilite", v)}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Civilité" /></SelectTrigger>
                        <SelectContent>
                          {CIVILITE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input placeholder="Prénom(s)" className="h-8 text-sm" value={identVal.Prenoms}
                        onChange={(e) => update("Prenoms", e.target.value)} />
                      <Input placeholder="Nom d'usage" className="h-8 text-sm" value={identVal.NomUsage}
                        onChange={(e) => update("NomUsage", e.target.value)} />
                      <Input placeholder="Nom de naissance" className="h-8 text-sm" value={identVal.NomNaissance}
                        onChange={(e) => update("NomNaissance", e.target.value)} />
                    </div>
                  </div>
                );
              }

              if (c.Type === "Date") {
                return (
                  <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                    {labelEl}{helpEl}
                    <Input id={`biz-${c.DataId}`} type="date" className="h-8 text-sm"
                      value={(values[c.DataId] as string) ?? ""}
                      onChange={(e) => onChange(c.DataId, e.target.value)} />
                  </div>
                );
              }

              if (c.Type === "Chiffre") {
                return (
                  <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                    {labelEl}{helpEl}
                    <Input id={`biz-${c.DataId}`} type="number" className="h-8 text-sm"
                      value={(values[c.DataId] as string) ?? ""}
                      onChange={(e) => onChange(c.DataId, e.target.value)} />
                  </div>
                );
              }

              if (c.Type === "Combo_autre" || c.Type === "RadiobuttonList") {
                const options = getOptions(c);
                if (options.length > 0) {
                  return (
                    <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                      {labelEl}{helpEl}
                      <Select
                        value={(values[c.DataId] as string) ?? ""}
                        onValueChange={(v) => onChange(c.DataId, v)}
                      >
                        <SelectTrigger id={`biz-${c.DataId}`} className="h-8 text-sm">
                          <SelectValue placeholder="Sélectionner…" />
                        </SelectTrigger>
                        <SelectContent>
                          {options.map((o) => (
                            <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }
              }

              return (
                <div key={c.DataId} className={cn("space-y-1", fullWidth && "col-span-2")}>
                  {labelEl}{helpEl}
                  <Input id={`biz-${c.DataId}`} className="h-8 text-sm"
                    value={(values[c.DataId] as string) ?? ""}
                    onChange={(e) => onChange(c.DataId, e.target.value)} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildFormValues(
  components: ArpegeFormComponent[],
  values: Record<string, unknown>,
): Array<{ id: string; valeur: unknown }> {
  return flattenComponents(components)
    .filter(({ component: c }) => c.Type !== "Pieces_jointes")
    .map(({ component: c }) => ({ id: c.DataId, valeur: values[c.DataId] ?? null }))
    .filter((e) => e.valeur !== null && e.valeur !== "");
}

/**
 * Valeurs proposées par l'analyse pour le formulaire métier, réduites aux
 * champs que ce formulaire saisit réellement (ni pièce jointe, ni identité) :
 * un `DataId` inconnu — schéma Arpège changé depuis l'analyse — est ignoré.
 */
function arpegeBusinessPrefill(
  components: ArpegeFormComponent[],
  prefill: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { component: c } of flattenComponents(components)) {
    if (c.Type === "Pieces_jointes" || c.Type === "Identite") continue;
    const value = prefill[c.DataId];
    if (typeof value === "string" && value.trim()) out[c.DataId] = value;
  }
  return out;
}

function businessRequiredMet(
  components: ArpegeFormComponent[],
  values: Record<string, unknown>,
  piecesJointes: Record<string, string[]>,
): boolean {
  return flattenComponents(components)
    .filter(({ component: c }) => isRequired(c))
    .every(({ component: c }) => {
      if (c.Type === "Pieces_jointes") {
        return (piecesJointes[c.DataId]?.length ?? 0) > 0;
      }
      if (c.Type === "Identite") {
        const id = values[c.DataId] as IdentiteValue | undefined;
        return id && (id.NomUsage || id.NomNaissance) && id.Prenoms;
      }
      const v = values[c.DataId];
      return v !== undefined && v !== null && String(v).trim().length > 0;
    });
}

// ── Main dialog ─────────────────────────────────────────────────────────────

export default function CreateTicketDialog({
  open,
  onOpenChange,
  courierId,
  organizationId,
  initialProcedureId,
  initialArpegeValues,
  initialSoclePrefill,
  initialArpegePrefill,
  initialSocleOrganizationId,
  courierSocleOrganizationId,
}: Props) {
  const qc = useQueryClient();
  const [procedureId, setProcedureId] = useState<string>("");
  // Organisation DESTINATAIRE de la demande (id du miroir socle_organizations) :
  // elle commande la liste des démarches proposées et l'organisme transmis à
  // Iris. Distincte de l'organisation gestionnaire du courrier, qui n'en est
  // que la valeur par défaut — adresser une demande aux services techniques ne
  // déplace pas le courrier.
  const [socleOrgId, setSocleOrgId] = useState<string | null>(null);
  const [orgPopoverOpen, setOrgPopoverOpen] = useState(false);
  const [procedurePopoverOpen, setProcedurePopoverOpen] = useState(false);
  const [arpegeValues, setArpegeValues] = useState<Record<string, string>>({});
  const [businessValues, setBusinessValues] = useState<Record<string, unknown>>({});
  const [piecesJointes, setPiecesJointes] = useState<Record<string, string[]>>({});
  const [socleAudience, setSocleAudience] = useState<Audience | null>(null);
  const [socleRequesterValues, setSocleRequesterValues] = useState<Record<string, string>>({});
  const [socleFormValues, setSocleFormValues] = useState<FormValues>({});

  useEffect(() => {
    if (open) {
      setProcedureId(initialProcedureId ?? "");
      // Suggestion de l'analyse d'abord, organisation du courrier ensuite :
      // l'IA a lu le courrier, le rattachement du courrier n'est qu'un défaut.
      setSocleOrgId(initialSocleOrganizationId ?? courierSocleOrganizationId ?? null);
      setArpegeValues(initialArpegeValues ?? {});
      setBusinessValues({});
      setPiecesJointes({});
      setSocleAudience(null);
      setSocleRequesterValues({});
      setSocleFormValues({});
    }
  }, [
    open, initialProcedureId, initialArpegeValues,
    initialSocleOrganizationId, courierSocleOrganizationId,
  ]);

  const { data: procedures, isLoading: loadingProcedures } = useQuery({
    queryKey: ["procedures-displayed", organizationId],
    queryFn: () => listProcedures(organizationId),
    enabled: !!organizationId && open,
  });

  // Miroir « qui propose quoi » : le référentiel active les démarches PAR
  // organisation, et Iris refuse le dépôt d'une démarche qu'un organisme
  // n'assure pas. Proposer un catalogue non filtré revient à laisser l'agent
  // buter sur ce refus après coup.
  const { data: activations } = useQuery({
    queryKey: ["procedure-activations", organizationId],
    queryFn: () => listProcedureActivations(organizationId),
    enabled: !!organizationId && open,
  });
  const activationIndex = useMemo(
    () => buildActivationIndex(activations ?? []),
    [activations],
  );

  const { data: socleOrgs, isLoading: loadingSocleOrgs } = useQuery({
    queryKey: ["socle-organizations", organizationId],
    queryFn: () => listSocleOrganizationTree(organizationId),
    enabled: !!organizationId && open,
  });
  // Liste indentée par la hiérarchie (motif ImapSettings / SignaturesSettings) :
  // « Services techniques » sous « ACCM » se lit mieux qu'un ordre alphabétique.
  const selectableOrgs = useMemo(
    () =>
      flattenSocleOrgTree(
        buildSocleOrgTree(
          (socleOrgs ?? []).filter((o) => !o.obsoleted_at && o.status !== "obsolete"),
        ),
      ),
    [socleOrgs],
  );
  const selectedOrg = selectableOrgs.find((o) => o.id === socleOrgId) ?? null;

  // Ne sont proposées que les démarches instruites quelque part — Iris ou
  // partenaire (cf. src/lib/procedure-origin.ts) —, et parmi elles ni les
  // obsolètes (retirées du référentiel), ni les masquées localement.
  const visibleProcedures = useMemo(
    () =>
      (procedures ?? []).filter(
        (p) => p.is_displayed && !p.obsoleted_at && isRequestableProcedure(p),
      ),
    [procedures],
  );
  // …ni celles que l'organisation destinataire n'assure pas — démarches Arpège
  // du Socle comprises. Une démarche que le référentiel ne connaît pas n'a
  // aucune activation et reste proposée — cf. src/lib/procedure-activation.ts.
  const displayedProcedures = useMemo(
    () => filterProceduresForOrganization(visibleProcedures, activationIndex, socleOrgId),
    [visibleProcedures, activationIndex, socleOrgId],
  );
  const selectedProcedure = displayedProcedures.find((p) => p.id === procedureId) ?? null;

  // État de l'interface Arpège du tenant (sans secret) : une démarche
  // partenaire reste listée mais grisée quand l'interface est suspendue.
  const { data: arpegeStatus } = useQuery({
    queryKey: ["partner-integration-status", organizationId, "arpege"],
    queryFn: () => getPartnerIntegrationStatus(organizationId, "arpege"),
    enabled: !!organizationId && open,
  });
  const arpegeActive = arpegeStatus ? arpegeStatus.configured && arpegeStatus.is_active : undefined;

  // Le flux Arpège dépend de la présence effective des références Arpège —
  // recopiées de `partner` pour une démarche venue du Socle —, pas de
  // external_source. Même règle que create-arpege-demande.
  const isArpege = !!selectedProcedure && procedureOrigin(selectedProcedure) === "arpege";
  const selectedSuspended = !!selectedProcedure && isPartnerSuspended(selectedProcedure, arpegeActive);
  // Démarche du référentiel : le dépôt exige l'organisation qui l'a activée.
  const arpegeNeedsOrg = isArpege && !!selectedProcedure?.socle_id && !socleOrgId;
  const arpegeFields = selectedProcedure?.arpege_config_fields?.ConfigInfoUsagerObligs ?? [];
  // Mémorisé : le préremplissage en dépend, une nouvelle référence à chaque rendu
  // relancerait l'effet pour rien.
  const formComponents = useMemo(
    () => selectedProcedure?.arpege_config_fields?.FormComponents ?? [],
    [selectedProcedure],
  );

  // Démarche Socle « native » (sans config Arpège) : rendu du contrat Socle
  // (requester_config + form_schema).
  const isSocle = !isArpege && selectedProcedure?.external_source === "socle";
  const socleConfig = useMemo(
    () =>
      isSocle && selectedProcedure?.requester_config
        ? parseRequesterConfig(selectedProcedure.requester_config)
        : null,
    [isSocle, selectedProcedure],
  );
  const socleSchema = useMemo(
    () => parseFormSchema(isSocle ? selectedProcedure?.form_schema : null),
    [isSocle, selectedProcedure],
  );
  const socleAudiencesList = useMemo(
    () => (socleConfig ? enabledAudiences(socleConfig) : []),
    [socleConfig],
  );
  const hasSocleRequester = socleAudiencesList.length > 0;
  const hasSocleFormFields = socleSchema.content.length > 0;
  const showSocleForm = hasSocleRequester || hasSocleFormFields;
  // Le public sélectionné, ou le premier activé par défaut.
  const currentAudience: Audience | null =
    socleAudience && socleAudiencesList.includes(socleAudience)
      ? socleAudience
      : socleAudiencesList[0] ?? null;

  const hasPiecesJointesField =
    (isArpege &&
      flattenComponents(formComponents).some(({ component: c }) => c.Type === "Pieces_jointes")) ||
    socleSchema.content.some((n) =>
      "kind" in n ? n.fields.some((f) => f.type === "attachment") : n.type === "attachment",
    );

  const { data: courierDocs = [] } = useQuery({
    queryKey: ["courier-documents", courierId],
    queryFn: () => getDocuments(courierId),
    enabled: hasPiecesJointesField && open,
  });

  // Expéditeur structuré du courrier (participant sender → contact Socle lié) :
  // source prioritaire du préremplissage demandeur, devant l'extraction LLM.
  const { data: participants, isLoading: loadingParticipants } = useQuery({
    queryKey: ["courier-participants", courierId],
    queryFn: () => getParticipants(courierId),
    enabled: open && !!courierId,
  });
  const senderParticipant = useMemo(
    () =>
      ((participants ?? []) as Array<SenderParticipantLike & { role?: string }>).find(
        (p) => p.role === "sender",
      ) ?? null,
    [participants],
  );
  // Best-effort : un Socle indisponible ou une fiche supprimée ne doit jamais
  // bloquer la création de demande (on retombe sur le participant brut).
  const { data: senderContact } = useQuery<SocleContact | null>({
    queryKey: ["socle-contact", organizationId, senderParticipant?.socle_contact_id],
    queryFn: async () => {
      try {
        return await getContact(organizationId, senderParticipant!.socle_contact_id!);
      } catch {
        return null;
      }
    },
    enabled: open && !!senderParticipant?.socle_contact_id,
  });

  // Application du préremplissage — une seule fois par (ouverture, démarche),
  // pour ne jamais écraser une saisie en cours.
  const prefillAppliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      prefillAppliedRef.current = null;
      return;
    }
    if (!procedureId || !selectedProcedure) return;
    if (loadingParticipants) return;
    // Un contact Socle est attendu : attendre son chargement avant d'appliquer.
    if (senderParticipant?.socle_contact_id && senderContact === undefined) return;
    if (prefillAppliedRef.current === procedureId) return;
    prefillAppliedRef.current = procedureId;

    const contact = senderContact ?? null;

    if (isArpege) {
      setArpegeValues(
        mergeNonEmpty(contactToArpegeValues(contact, senderParticipant), initialArpegeValues ?? {}),
      );
      // Formulaire métier : seulement pour la démarche de l'action suggérée.
      const fromSuggestion = procedureId === initialProcedureId ? initialArpegePrefill : null;
      if (fromSuggestion) setBusinessValues(arpegeBusinessPrefill(formComponents, fromSuggestion));
      return;
    }
    if (!showSocleForm) return;

    // Le préremplissage de formulaire est spécifique à la démarche de l'action
    // suggérée ; l'identité du demandeur vaut pour toute démarche.
    const fromSuggestion = procedureId === initialProcedureId ? initialSoclePrefill : null;
    if (socleConfig) {
      setSocleAudience(
        resolveAudience(
          socleAudiencesList,
          contactTypeToAudience(contact?.contact_type),
          fromSuggestion?.audience ?? null,
        ),
      );
    }
    setSocleRequesterValues(
      mergeNonEmpty(
        contactToSocleRequester(contact, senderParticipant),
        arpegePrefillToSocleRequester(initialArpegeValues),
      ),
    );
    if (fromSuggestion?.form) {
      setSocleFormValues(applySocleFormPrefill(socleSchema, fromSuggestion.form));
    }
  }, [
    open, procedureId, selectedProcedure, isArpege, showSocleForm,
    socleConfig, socleAudiencesList, socleSchema, loadingParticipants,
    senderParticipant, senderContact, initialArpegeValues, initialSoclePrefill,
    initialArpegePrefill, formComponents, initialProcedureId,
  ]);

  // Sélection (ou désélection avec "") d'une démarche : purge des formulaires
  // spécifiques et ré-application du préremplissage.
  const selectProcedure = (id: string) => {
    setProcedureId(id);
    setArpegeValues({});
    setBusinessValues({});
    setPiecesJointes({});
    setSocleAudience(null);
    setSocleRequesterValues({});
    setSocleFormValues({});
    prefillAppliedRef.current = null;
  };

  // Changer de destinataire peut retirer la démarche en cours du catalogue de
  // l'organisation : on la lâche plutôt que de laisser une sélection invisible
  // (et refusée au dépôt) survivre au changement.
  const selectSocleOrg = (id: string | null) => {
    setSocleOrgId(id);
    if (procedureId && !isProcedureOfferedBy(activationIndex, procedureId, id)) {
      selectProcedure("");
    }
  };

  const handleArpegeChange = (code: string, value: string) =>
    setArpegeValues((prev) => ({ ...prev, [code]: value }));

  const handleBusinessChange = (dataId: string, value: unknown) =>
    setBusinessValues((prev) => ({ ...prev, [dataId]: value }));

  const togglePieceJointe = (dataId: string, docId: string) =>
    setPiecesJointes((prev) => {
      const current = prev[dataId] ?? [];
      return {
        ...prev,
        [dataId]: current.includes(docId)
          ? current.filter((id) => id !== docId)
          : [...current, docId],
      };
    });

  const handleNewDoc = (dataId: string, doc: CourierDocument) => {
    qc.setQueryData(["courier-documents", courierId], (old: CourierDocument[] | undefined) =>
      [doc, ...(old ?? [])],
    );
    togglePieceJointe(dataId, doc.id);
  };

  const arpegeObligatoryMet = arpegeFields
    .filter((f) => f.Obligatoire && FIELD_CODES_DISPLAYED.includes(f.Code))
    .every((f) => (arpegeValues[f.Code] ?? "").trim().length > 0);

  const bizObligatoryMet =
    formComponents.length === 0 ||
    businessRequiredMet(formComponents, businessValues, piecesJointes);

  const socleObligatoryMet =
    !showSocleForm ||
    ((!hasSocleRequester ||
      (!!socleConfig &&
        !!currentAudience &&
        requesterRequiredMet(socleConfig, currentAudience, socleRequesterValues))) &&
      (!hasSocleFormFields || formRequiredMet(socleSchema, socleFormValues, piecesJointes)));

  // Le dépôt dans Iris se raconte dans le toast de fin : une action peut être
  // créée ici et refusée là-bas (démarche obsolète, demandeur absent…) sans que
  // rien ne soit perdu — l'onglet Actions liées propose alors le renvoi.
  const saveMutation = useMutation<{
    irisReference?: string | null;
    irisError?: string | null;
    /** Pièce réclamée par la démarche restée dans Clara — la demande est incomplète. */
    attachmentsRefused?: string | null;
  }>({
    mutationFn: async () => {
      if (isArpege) {
        const formValues = buildFormValues(formComponents, businessValues);
        const created = await createArpegeTicket({
          organizationId,
          courierId,
          procedureId,
          demandeur: arpegeValues,
          formValues,
          pieceJointes: piecesJointes,
          socleOrganizationId: socleOrgId,
        });
        await logEvent(organizationId, courierId, "ticket_created", {
          ticket_id: created.id,
          procedure_id: procedureId,
          arpege_ref: created.arpege_demande_ref,
          socle_organization_id: socleOrgId,
        });
        return {};
      }

      const socleData = showSocleForm
        ? buildSocleDemandeData({
            config: hasSocleRequester ? socleConfig : null,
            audience: hasSocleRequester ? currentAudience : null,
            requesterValues: socleRequesterValues,
            schema: socleSchema,
            formValues: socleFormValues,
            attachments: piecesJointes,
          })
        : null;

      const created = await createTicket({
        organizationId,
        courierId,
        procedureId,
        socleData,
        socleOrganizationId: socleOrgId,
      });
      await logEvent(organizationId, courierId, "ticket_created", {
        ticket_id: created.id,
        procedure_id: procedureId,
        socle_organization_id: socleOrgId,
      });

      // Démarche du référentiel ⇒ la demande appartient à Iris. Le ticket est
      // créé d'abord : son id EST l'external_id côté Iris, il ne peut pas être
      // connu avant. Un échec de dépôt ne détruit donc rien et se rejoue à
      // l'identique (clé d'idempotence portée par le ticket).
      if (isSocle) {
        try {
          const pushed = await pushIrisRequest(created.id);
          // Organisation qui ne dépose pas dans Iris : rien à annoncer.
          if (pushed.skipped) return {};
          return {
            irisReference: pushed.reference,
            attachmentsRefused: pushed.attachments_refused ?? null,
          };
        } catch (e) {
          return { irisError: e instanceof Error ? e.message : String(e) };
        }
      }
      return {};
    },
    onSuccess: (result) => {
      if (result.irisError) {
        toast.warning(`Action créée, non transmise à Iris : ${result.irisError}`);
      } else if (result.irisReference && result.attachmentsRefused) {
        // Déposée, mais sans une pièce que la démarche réclame : l'agent doit
        // le savoir tout de suite — la ligne du ticket le redira ensuite.
        toast.warning(
          `Demande ${result.irisReference} déposée dans Iris — ${result.attachmentsRefused}`,
        );
      } else if (result.irisReference) {
        toast.success(`Action créée — demande ${result.irisReference} déposée dans Iris`);
      } else {
        toast.success("Demande créée");
      }
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // La démarche commande tout : sans elle, il n'y a personne pour instruire la
  // demande. Restent les champs exigés par la démarche elle-même (Arpège ou
  // contrat Socle) — Clara n'en ajoute aucun. On exige la démarche RETENUE, pas
  // seulement un id : une démarche absente de la liste (suggestion que
  // l'organisation destinataire n'assure pas) serait invisible et refusée au
  // dépôt.
  const canSubmit =
    !saveMutation.isPending &&
    !!selectedProcedure &&
    !selectedSuspended &&
    !arpegeNeedsOrg &&
    (!isArpege || (arpegeObligatoryMet && bizObligatoryMet)) &&
    socleObligatoryMet;

  const hasBothForms = isArpege && arpegeFields.length > 0 && formComponents.length > 0;
  const hasArpegeOnly = isArpege && arpegeFields.length > 0 && formComponents.length === 0;
  const hasBusinessOnly = isArpege && arpegeFields.length === 0 && formComponents.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col max-h-[92vh]",
          isArpege ? "sm:max-w-3xl" : showSocleForm ? "sm:max-w-2xl" : "sm:max-w-lg",
        )}
      >
        <DialogHeader className="shrink-0 pb-2">
          <DialogTitle>Nouvelle demande</DialogTitle>
          {selectedProcedure && (
            <p className="text-sm text-muted-foreground">{selectedProcedure.name}</p>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 pr-1 space-y-5 py-1">

          {/* Organisation destinataire — commande la liste des démarches */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Organisation destinataire</Label>
            <div className="flex items-center gap-1.5">
              <Popover open={orgPopoverOpen} onOpenChange={setOrgPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={orgPopoverOpen}
                    className="flex-1 justify-between h-9 min-w-0"
                    disabled={loadingSocleOrgs}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Building2 className="h-4 w-4 shrink-0 opacity-50" />
                      {selectedOrg ? (
                        <span className="truncate">{selectedOrg.name}</span>
                      ) : loadingSocleOrgs ? "Chargement…" : (
                        <span className="text-muted-foreground">Toutes les organisations</span>
                      )}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Rechercher une organisation…" />
                    <CommandList>
                      <CommandEmpty>Aucune organisation trouvée</CommandEmpty>
                      <CommandGroup>
                        {selectableOrgs.map((o) => (
                          <CommandItem
                            key={o.id}
                            value={o.name}
                            onSelect={() => {
                              selectSocleOrg(o.id);
                              setOrgPopoverOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", socleOrgId === o.id ? "opacity-100" : "opacity-0")} />
                            <span className="truncate" style={{ paddingLeft: `${(o.depth - 1) * 12}px` }}>
                              {o.name}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedOrg && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                  onClick={() => selectSocleOrg(null)} title="Retirer l'organisation">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              Les démarches proposées sont celles que cette organisation assure dans le référentiel.
            </p>
          </div>

          {/* Démarche — sans elle, personne n'instruit la demande */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Démarche<span className="text-destructive ml-0.5">*</span>
            </Label>
            <div className="flex items-center gap-1.5">
              <Popover open={procedurePopoverOpen} onOpenChange={setProcedurePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={procedurePopoverOpen}
                    className="flex-1 justify-between h-9 min-w-0"
                    disabled={loadingProcedures}
                  >
                    <span className="truncate">
                      {selectedProcedure
                        ? selectedProcedure.name
                        : loadingProcedures ? "Chargement…" : (
                          <span className="text-muted-foreground">Sélectionner une démarche…</span>
                        )}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Rechercher une démarche…" />
                    <CommandList>
                      <CommandEmpty>
                        {displayedProcedures.length === 0 && selectedOrg
                          ? `${selectedOrg.name} n'assure aucune démarche dans le référentiel.`
                          : "Aucune démarche trouvée"}
                      </CommandEmpty>
                      <CommandGroup>
                        {displayedProcedures.map((p) => {
                          const suspended = isPartnerSuspended(p, arpegeActive);
                          return (
                            <CommandItem
                              key={p.id}
                              value={p.name}
                              className="group"
                              disabled={suspended}
                              onSelect={() => {
                                selectProcedure(p.id);
                                setProcedurePopoverOpen(false);
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4", procedureId === p.id ? "opacity-100" : "opacity-0")} />
                              {p.name}
                              {procedureOriginLabel(p) && (
                                <span className="ml-auto text-[10px] text-muted-foreground group-data-[selected=true]:text-accent-foreground">
                                  {suspended
                                    ? `${procedureOriginLabel(p)} · interface suspendue`
                                    : procedureOriginLabel(p)}
                                </span>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedProcedure && (
                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                  onClick={() => selectProcedure("")} title="Retirer la démarche">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            {selectedSuspended && (
              <p className="text-xs text-destructive">
                L'interface Arpège est suspendue pour cette collectivité : la demande ne peut pas
                être transmise.
              </p>
            )}
            {!selectedSuspended && arpegeNeedsOrg && (
              <p className="text-xs text-muted-foreground">
                Choisissez l'organisation destinataire : la demande part chez Arpège au nom de
                l'organisation qui assure cette démarche.
              </p>
            )}
          </div>

          {/* Arpège forms — side by side when both present */}
          {hasBothForms && (
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <SectionHeader icon={User} title="Demandeur" subtitle="Identité de la personne concernée" />
                <ArpegeForm fields={arpegeFields} values={arpegeValues} onChange={handleArpegeChange} />
              </div>
              <div className="space-y-3">
                <SectionHeader icon={FileText} title="Données métier" subtitle="Informations spécifiques à la démarche" />
                <ArpegeBusinessForm
                  components={formComponents}
                  values={businessValues}
                  onChange={handleBusinessChange}
                  courierDocs={courierDocs}
                  piecesJointes={piecesJointes}
                  onTogglePieceJointe={togglePieceJointe}
                  onNewDoc={handleNewDoc}
                  orgId={organizationId}
                  courierId={courierId}
                />
              </div>
            </div>
          )}

          {hasArpegeOnly && (
            <div className="space-y-3">
              <SectionHeader icon={User} title="Demandeur" subtitle="Identité de la personne concernée" />
              <ArpegeForm fields={arpegeFields} values={arpegeValues} onChange={handleArpegeChange} />
            </div>
          )}

          {hasBusinessOnly && (
            <div className="space-y-3">
              <SectionHeader icon={FileText} title="Données métier" subtitle="Informations spécifiques à la démarche" />
              <ArpegeBusinessForm
                components={formComponents}
                values={businessValues}
                onChange={handleBusinessChange}
                courierDocs={courierDocs}
                piecesJointes={piecesJointes}
                onTogglePieceJointe={togglePieceJointe}
                onNewDoc={handleNewDoc}
                orgId={organizationId}
                courierId={courierId}
              />
            </div>
          )}

          {/* Démarche Socle : champs demandeur + formulaire du contrat */}
          {hasSocleRequester && socleConfig && currentAudience && (
            <div className="space-y-3">
              <SectionHeader
                icon={User}
                title="Demandeur"
                subtitle="Informations attendues sur le demandeur"
              />
              <SocleRequesterForm
                config={socleConfig}
                audience={currentAudience}
                onAudienceChange={setSocleAudience}
                values={socleRequesterValues}
                onChange={(key, value) =>
                  setSocleRequesterValues((prev) => ({ ...prev, [key]: value }))
                }
              />
            </div>
          )}

          {hasSocleFormFields && (
            <div className="space-y-3">
              <SectionHeader
                icon={FileText}
                title="Formulaire"
                subtitle="Informations spécifiques à la démarche"
              />
              <SocleFormFields
                schema={socleSchema}
                values={socleFormValues}
                onChange={(fieldId, value) =>
                  setSocleFormValues((prev) => ({ ...prev, [fieldId]: value }))
                }
                attachments={piecesJointes}
                onToggleAttachment={togglePieceJointe}
                courierDocs={courierDocs}
                orgId={organizationId}
                courierId={courierId}
                onNewDoc={handleNewDoc}
              />
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 pt-3 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            Annuler
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!canSubmit}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isArpege ? "Créer la demande Arpège" : "Créer la demande"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
