import { Card } from "@/components/ui/card";
import { assignableOrgs } from "@/services/socleOrgConfigService";
import type { useCourierWorkspace, WorkspaceCourier } from "@/hooks/useCourierWorkspace";
import ContentIntentsTab from "../ContentIntentsTab";
import CourierRequestSummary from "../CourierRequestSummary";
import DocumentManager from "../DocumentManager";
import DocumentViewer from "../DocumentViewer";
import LinkedCouriersSection from "../LinkedCouriersSection";
import { ReplyVisaSection } from "../ReplyVisaTrail";
import ServiceSuggestion from "../ServiceSuggestion";
import { courierMetadata } from "@/lib/courier-workspace";

type Workspace = ReturnType<typeof useCourierWorkspace>;

interface Props {
  ws: Workspace;
  courier: WorkspaceCourier;
  organizationId: string;
  /** Motif pour lequel on ne peut pas encore créer d'action (courrier non orienté), le cas échéant. */
  creationBlockedReason: string | null | undefined;
  onCreateAction: () => void;
}

/** Onglet « Courrier » : liens suggérés, demande analysée, visa (sortant), pièces et aperçu. */
export function WorkspaceDetailTab({ ws, courier, organizationId, creationBlockedReason, onCreateAction }: Props) {
  const {
    effectiveReadOnly,
    isOutbound,
    isFinalState,
    isInitialState,
    selectedTags,
    services,
    availableServices,
    currentService,
    serviceMutation,
    transferMutation,
    setTransferTargetServiceId,
    setTransferConfirmOpen,
    displayDocuments,
    selectedDocId,
    setSelectedDocId,
  } = ws;

  const analysisReadOnly = effectiveReadOnly || isFinalState;
  const assignableIds = availableServices.map((o) => o.id);
  const transferableIds = assignableOrgs(services ?? [])
    .filter((o) => o.id !== currentService?.id)
    .map((o) => o.id);
  const inlineDocs = displayDocuments
    .filter((d) => d.id.startsWith("inline:"))
    .map((d) => ({ id: d.id, file_name: d.file_name }));

  return (
    <>
      {!isOutbound && (
        <LinkedCouriersSection
          courierId={courier.id}
          organizationId={organizationId}
          disabled={effectiveReadOnly}
          // Les liens déjà posés sont dans la colonne de contexte : ici
          // on ne sert que les suggestions restées à trancher.
          showRelations={false}
        />
      )}

      {!isOutbound && (
        <CourierRequestSummary
          courierId={courier.id}
          organizationId={organizationId}
          onCreateAction={creationBlockedReason || analysisReadOnly ? undefined : onCreateAction}
          pendingContext={
            analysisReadOnly
              ? null
              : {
                  subject: courier.subject ?? null,
                  appliedTags: selectedTags,
                  service: {
                    currentId: currentService?.id ?? null,
                    isInitialState,
                    assignableIds,
                    transferableIds,
                  },
                }
          }
          analysisDetail={
            <ContentIntentsTab
              courierId={courier.id}
              organizationId={organizationId}
              readOnly={analysisReadOnly}
              isInitialState={isInitialState}
              serviceSuggestion={
                <ServiceSuggestion
                  courierId={courier.id}
                  currentOrgId={currentService?.id ?? null}
                  isInitialState={isInitialState}
                  readOnly={analysisReadOnly}
                  orgs={services ?? []}
                  assignableIds={assignableIds}
                  transferableIds={transferableIds}
                  onAssign={(id) => serviceMutation.mutate(id)}
                  onTransfer={(id) => {
                    setTransferTargetServiceId(id);
                    setTransferConfirmOpen(true);
                  }}
                  busy={serviceMutation.isPending || transferMutation.isPending}
                />
              }
            />
          }
        />
      )}

      {isOutbound && (
        // `empty:hidden` : sans visa, la section ne rend rien — pas de carte vide.
        <Card className="p-6 shadow-airbnb-sm empty:hidden">
          <ReplyVisaSection organizationId={organizationId} replyId={courier.id} stateId={courier.workflow_state_id} />
        </Card>
      )}

      {/* La liste des pièces pilote l'aperçu voisin. */}
      <Card className="grid overflow-hidden shadow-airbnb-sm md:h-[70vh] md:min-h-[480px] md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="overflow-y-auto border-b border-border px-3 py-5 md:border-b-0 md:border-r">
          <DocumentManager
            layout="list"
            courierId={courier.id}
            organizationId={organizationId}
            selectedDocId={selectedDocId}
            onSelectDoc={setSelectedDocId}
            readOnly={effectiveReadOnly}
            leadingItems={inlineDocs}
            ignoredAttachments={
              (courierMetadata(courier.metadata).ignored_attachments as unknown as { name: string; size: number }[] | undefined) ?? []
            }
          />
        </div>
        <div className="flex min-h-[420px] min-w-0 flex-col bg-muted p-3">
          <DocumentViewer
            documents={displayDocuments}
            currentId={selectedDocId}
            onChange={setSelectedDocId}
            organizationId={organizationId}
          />
        </div>
      </Card>
    </>
  );
}
