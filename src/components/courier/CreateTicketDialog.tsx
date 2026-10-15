import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, User, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listProcedureActivations, listProcedures } from "@/services/procedureService";
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
} from "@/lib/procedure-origin";
import { getPartnerIntegrationStatus } from "@/services/partnerIntegrationService";
import {
  createArpegeTicketFlow,
  createSocleTicketFlow,
} from "@/services/ticketCreationFlowService";
import { describeTicketCreation, type TicketCreationResult } from "@/lib/ticket-creation-result";
import {
  arpegeBusinessPrefill,
  buildFormValues,
  businessRequiredMet,
  demandeurRequiredMet,
  flattenComponents,
} from "@/lib/arpege-business-form";
import { getDocuments } from "@/services/courierDocumentService";
import { getParticipants } from "@/services/courierParticipantService";
import { getContact, type SocleContact } from "@/services/socleContactService";
import { SocleFormFields, SocleRequesterForm } from "./SocleDemandeForm";
import { ArpegeForm, ArpegeBusinessForm } from "./create-ticket/ArpegeForms";
import SectionHeader from "./create-ticket/SectionHeader";
import { OrganizationPicker, ProcedurePicker } from "./create-ticket/TargetPickers";
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

  const arpegeObligatoryMet = demandeurRequiredMet(arpegeFields, arpegeValues);

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
  const saveMutation = useMutation<TicketCreationResult>({
    mutationFn: async () => {
      const base = { organizationId, courierId, procedureId, socleOrganizationId: socleOrgId };
      if (isArpege) {
        return createArpegeTicketFlow({
          ...base,
          demandeur: arpegeValues,
          formValues: buildFormValues(formComponents, businessValues),
          pieceJointes: piecesJointes,
        });
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
      // Démarche du référentiel ⇒ la demande appartient à Iris.
      return createSocleTicketFlow({ ...base, socleData, pushToIris: isSocle });
    },
    onSuccess: (result) => {
      const notice = describeTicketCreation(result);
      if (notice.level === "warning") toast.warning(notice.message);
      else toast.success(notice.message);
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
          <OrganizationPicker
            options={selectableOrgs}
            selected={selectedOrg}
            loading={loadingSocleOrgs}
            onSelect={selectSocleOrg}
          />

          <ProcedurePicker
            options={displayedProcedures}
            selected={selectedProcedure}
            selectedId={procedureId}
            loading={loadingProcedures}
            arpegeActive={arpegeActive}
            selectedOrgName={selectedOrg?.name ?? null}
            selectedSuspended={selectedSuspended}
            arpegeNeedsOrg={arpegeNeedsOrg}
            onSelect={selectProcedure}
          />

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
