import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  BellRing,
  Check,
  CircleCheck,
  CircleDashed,
  FileText,
  Loader2,
  Maximize2,
  Route,
  Sparkles,
  TriangleAlert,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import DocumentViewer from "@/components/courier/DocumentViewer";
import { channelLabels } from "@/hooks/useCourierWorkspace";
import { useCourierDisplayDocuments } from "@/hooks/useCourierDisplayDocuments";
import { getMailroomCourier } from "@/services/mailroomService";
import type { SocleOrgWithConfig } from "@/services/socleOrgConfigService";
import { formatDay, resolveSlaTargets } from "@/lib/courier-sla";
import {
  QUALIFY_REASONS,
  slaProgress,
  trackingTimeline,
  type MailroomItem,
  type TimelineKind,
} from "@/lib/mailroom";
import { cn } from "@/lib/utils";
import type { CourierChannel } from "@/types/courier";
import OrgChoice from "./OrgChoice";
import SubjectSuggestion from "./SubjectSuggestion";
import TagSuggestion from "./TagSuggestion";
import { TONE_CHIP, TONE_DOT, TONE_TEXT, businessDays, fullDate, stageLabel, type Tone } from "./mailroomDisplay";

interface Props {
  item: MailroomItem;
  organizationId: string;
  orgs: SocleOrgWithConfig[];
  assignable: SocleOrgWithConfig[];
  canEdit: boolean;
  onRoute: (courierId: string, org: SocleOrgWithConfig) => void;
  onReassign: (courierId: string, org: SocleOrgWithConfig) => void;
  onRemind: (courierId: string) => void;
  onAnalyze: (courierId: string) => void;
  analyzing: boolean;
  /** Fourni : bouton « Supprimer » dans l'en-tête (confirmation portée par la page). */
  onDelete?: (item: MailroomItem) => void;
  busy: boolean;
}

const TIMELINE_DOT: Record<TimelineKind, string> = {
  done: "bg-primary ring-primary/15",
  warn: "bg-warning ring-warning/20",
  late: "bg-destructive ring-destructive/20",
  todo: "bg-card ring-border",
};

/** Date d'un jalon : instant ISO ou jour civil « AAAA-MM-JJ ». */
function stepDate(value: string | null): string {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDay(value) : fullDate(value);
}

export default function MailroomPanel({
  item,
  organizationId,
  orgs,
  assignable,
  canEdit,
  onRoute,
  onReassign,
  onRemind,
  onAnalyze,
  analyzing,
  onDelete,
  busy,
}: Props) {
  const navigate = useNavigate();
  const { row } = item;
  const stage = stageLabel(item);
  const channel = channelLabels[row.channel as CourierChannel] ?? row.channel;
  const orgName = (id: string | null) => (id ? (orgs.find((o) => o.id === id)?.name ?? null) : null);
  const orgById = (id: string | null) => (id ? (assignable.find((o) => o.id === id) ?? null) : null);

  // Choix du service : proposition de l'IA par défaut (si elle est routable).
  const suggested = orgById(row.suggested_socle_organization_id)?.id ?? null;
  const [pick, setPick] = useState<string | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [docId, setDocId] = useState<string | null>(null);
  useEffect(() => {
    setPick(item.stage === "to_validate" ? suggested : null);
    setReassignOpen(false);
    setDocId(null);
  }, [row.id, item.stage, suggested]);

  const candidates = [row.suggested_socle_organization_id, ...row.suggested_service_alternatives].filter(
    (id): id is string => !!id,
  );
  const pickedOrg = orgById(pick);

  const { data: courier } = useQuery({
    queryKey: ["mailroom-courier", row.id],
    queryFn: () => getMailroomCourier(organizationId, row.id),
  });
  const { displayDocuments } = useCourierDisplayDocuments(courier ?? null, organizationId);

  const dims: { label: string; value: string; tone: Tone }[] = [
    { label: "Canal", value: channel, tone: "muted" },
    {
      label: "Analyse",
      value:
        row.analysis_status === "running" || row.analysis_status === "pending"
          ? "En cours"
          : row.has_analysis
            ? "Analysé"
            : row.analysis_status === "failed"
              ? "Échec"
              : "Non analysé",
      tone:
        row.analysis_status === "running" || row.analysis_status === "pending"
          ? "warning"
          : row.has_analysis
            ? "primary"
            : row.analysis_status === "failed"
              ? "destructive"
              : "muted",
    },
    {
      label: "Qualification",
      value:
        item.stage === "to_qualify"
          ? "À qualifier"
          : item.stage === "to_validate"
            ? "À valider"
            : item.stage === "analysing" || item.stage === "to_reorient"
              ? "—"
              : "Validée",
      tone: item.stage === "to_qualify" ? "secondary" : item.stage === "to_validate" ? "primary" : "muted",
    },
    {
      label: "Traitement",
      value:
        item.stage === "routed" || item.stage === "late" || item.stage === "done"
          ? stage.label
          : item.stage === "to_reorient"
            ? "Renvoyé"
            : "À router",
      tone: item.stage === "late" ? "destructive" : item.stage === "to_reorient" ? "warning" : item.stage === "routed" ? "primary" : "muted",
    },
  ];

  const routeButton = (label: string) => (
    <Button
      size="lg"
      className="h-10 gap-2 font-bold"
      disabled={!pickedOrg || busy || !canEdit}
      onClick={() => pickedOrg && onRoute(row.id, pickedOrg)}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
      {pickedOrg ? `${label} ${pickedOrg.name}` : "Choisissez un service"}
    </Button>
  );

  const targets = resolveSlaTargets(orgs, pickedOrg?.id ?? row.suggested_socle_organization_id);
  const progress = slaProgress(item);
  const late = item.stage === "late";

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold", TONE_CHIP[stage.tone])}>
          {stage.label}
        </span>
        {row.chrono && <span className="font-mono text-xs text-muted-foreground">{row.chrono}</span>}
        <div className="flex-1" />
        <Button variant="outline" size="icon" className="h-8 w-8" title="Ouvrir la fiche" onClick={() => navigate(`/courrier/${row.id}`)}>
          <Maximize2 className="h-4 w-4" />
        </Button>
        {onDelete && (
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:border-destructive/35 hover:bg-destructive/5 hover:text-destructive"
            title="Supprimer le courrier"
            aria-label="Supprimer le courrier"
            onClick={() => onDelete(item)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-lg font-bold leading-snug [text-wrap:pretty]">{row.subject || "Sans objet"}</h3>
        <p className="text-sm text-muted-foreground">
          {[row.sender_name || "Expéditeur non identifié", channel, `reçu le ${fullDate(row.received_at ?? row.created_at)}`].join(" · ")}
        </p>
      </div>

      {row.has_analysis && (
        <SubjectSuggestion
          organizationId={organizationId}
          courierId={row.id}
          currentSubject={row.subject}
          canEdit={canEdit}
        />
      )}
      {/* Attend le courrier chargé : l'ajout réécrit `metadata`, il ne doit
          jamais partir d'un objet vide (il effacerait le reste). */}
      {row.has_analysis && courier && (
        <TagSuggestion
          organizationId={organizationId}
          courierId={row.id}
          metadata={courier.metadata}
          canEdit={canEdit}
        />
      )}

      <div className="grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4">
        {dims.map((d, i) => (
          <div key={d.label} className={cn("flex flex-col gap-1 px-3 py-2.5", i > 0 && "sm:border-l", i % 2 === 1 && "border-l")}>
            <span className="text-xs text-muted-foreground">{d.label}</span>
            <span className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
              <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", TONE_DOT[d.tone])} />
              {d.value}
            </span>
          </div>
        ))}
      </div>

      {item.stage === "to_qualify" && item.reason && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-2.5 rounded-lg bg-secondary/30 px-3.5 py-3 text-sm leading-relaxed text-secondary-foreground">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <strong>{QUALIFY_REASONS[item.reason].title}</strong>
              <br />
              {QUALIFY_REASONS[item.reason].text}
              {row.suggested_service_reason && (
                <>
                  <br />
                  <span className="italic">Clara : « {row.suggested_service_reason} »</span>
                </>
              )}
            </span>
          </div>
          {canEdit && (item.reason === "not_analysed" || item.reason === "analysis_failed") && (
            <Button variant="outline" className="h-10 gap-2 font-bold" disabled={analyzing} onClick={() => onAnalyze(row.id)}>
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-primary" />}
              {item.reason === "analysis_failed" ? "Relancer l'analyse IA" : "Lancer l'analyse IA"}
            </Button>
          )}
          {(!row.sender_name || !row.subject) && (
            <p className="text-xs text-muted-foreground">
              {!row.sender_name ? "Expéditeur" : "Objet"} à compléter —{" "}
              <button type="button" className="font-bold text-primary hover:underline" onClick={() => navigate(`/courrier/${row.id}`)}>
                compléter dans la fiche
              </button>
            </p>
          )}
          <OrgChoice
            label="Service destinataire"
            candidates={candidates}
            suggestedId={row.suggested_socle_organization_id}
            assignable={assignable}
            value={pick}
            onChange={setPick}
          />
          {routeButton("Qualifier et router vers")}
        </div>
      )}

      {item.stage === "to_validate" && (
        <div className="flex flex-col gap-4">
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-primary/5 px-4 py-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold">Proposition de Clara</span>
              <div className="flex-1" />
              {row.suggested_service_confidence !== null && (
                <span
                  className={cn(
                    "inline-flex h-6 items-center rounded-full px-2.5 text-xs font-bold",
                    row.suggested_service_confidence >= 90 ? TONE_CHIP.primary : TONE_CHIP.secondary,
                  )}
                >
                  Confiance {row.suggested_service_confidence} %
                </span>
              )}
            </div>
            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 px-4 py-3.5 text-sm">
              {row.first_intent && (
                <>
                  <dt className="text-muted-foreground">Nature</dt>
                  <dd>{row.first_intent}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Échéance</dt>
              <dd>{targets.resolutionDays ? `Réponse sous ${targets.resolutionDays} jours ouvrés` : "Sans objectif fixé"}</dd>
              <dt className="text-muted-foreground">Service</dt>
              <dd className="font-semibold text-primary">{orgName(row.suggested_socle_organization_id)}</dd>
              {row.suggested_service_reason && (
                <>
                  <dt className="text-muted-foreground">Pourquoi</dt>
                  <dd className="text-muted-foreground">{row.suggested_service_reason}</dd>
                </>
              )}
            </dl>
          </div>
          <OrgChoice
            label="Changer de service"
            candidates={candidates}
            suggestedId={row.suggested_socle_organization_id}
            assignable={assignable}
            value={pick}
            onChange={setPick}
          />
          {routeButton("Valider et router vers")}
        </div>
      )}

      {(item.stage === "routed" || item.stage === "late") && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5 rounded-lg border px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <Route className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{row.routed_at ? "Routé vers" : "Confié à"}</span>
              <strong>{row.assigned_service ?? "—"}</strong>
              {row.routed_at && <span className="text-muted-foreground">le {fullDate(row.routed_at)}</span>}
            </div>
            {progress !== null && (
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", late ? "bg-destructive" : item.primary?.status.kind === "due_soon" ? "bg-warning" : "bg-primary")}
                  style={{ width: `${Math.max(6, progress)}%` }}
                />
              </div>
            )}
            <span className={cn("text-xs font-semibold", late ? TONE_TEXT.destructive : TONE_TEXT.muted)}>
              {item.sla.resolution.dueDay
                ? late && item.primary
                  ? `${item.primary.axis === "ack" ? "Accusé de réception" : "Réponse"} en retard de ${businessDays(Math.abs(item.primary.status.margin ?? 0) || 1)} — échéance ${formatDay(item.primary.status.dueDay!)}`
                  : `Réponse attendue le ${formatDay(item.sla.resolution.dueDay)}`
                : "Aucun délai fixé pour ce service"}
            </span>
          </div>

          <ol className="flex flex-col">
            {trackingTimeline(item, channel).map((step, i) => (
              <li key={i} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 pb-3">
                <span className={cn("mx-[5px] mt-[5px] h-2.5 w-2.5 rounded-full ring-[3px]", TIMELINE_DOT[step.kind])} />
                <span
                  className={cn(
                    "text-[13px] font-medium",
                    step.kind === "late" ? "text-destructive" : step.kind === "todo" ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {step.label}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">{stepDate(step.date)}</span>
              </li>
            ))}
          </ol>

          {canEdit && (
            <>
              <div className="flex gap-2.5">
                <Button
                  className={cn("h-10 flex-1 gap-2 font-bold", late && "bg-destructive hover:bg-destructive/90")}
                  disabled={busy}
                  onClick={() => onRemind(row.id)}
                >
                  <BellRing className="h-4 w-4" />
                  Relancer le service
                </Button>
                <Button
                  variant="outline"
                  className="h-10 gap-2 font-bold"
                  aria-expanded={reassignOpen}
                  onClick={() => setReassignOpen((v) => !v)}
                >
                  <Undo2 className="h-4 w-4" />
                  Réaffecter
                </Button>
              </div>
              {reassignOpen && (
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-3.5">
                  <OrgChoice
                    label="Transférer à"
                    candidates={[]}
                    suggestedId={null}
                    assignable={assignable.filter((o) => o.id !== row.socle_organization_id)}
                    value={pick}
                    onChange={setPick}
                  />
                  <p className="text-[12.5px] text-muted-foreground">
                    Le courrier repart à l'état initial du circuit du service choisi, dont les membres sont prévenus.
                  </p>
                  <Button
                    variant="outline"
                    disabled={!pickedOrg || busy}
                    onClick={() => pickedOrg && onReassign(row.id, pickedOrg)}
                    className="gap-2 font-bold"
                  >
                    <Check className="h-4 w-4" />
                    {pickedOrg ? `Transférer à ${pickedOrg.name}` : "Choisissez un service"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {item.stage === "to_reorient" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5 rounded-lg bg-warning/10 px-4 py-3.5">
            <span className="flex items-center gap-2 text-sm font-bold text-warning">
              <Undo2 className="h-4 w-4" />
              Renvoyé par {row.returned_from ?? "un service"} le {fullDate(row.returned_at)}
            </span>
            <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-sm leading-relaxed">
              <CircleCheck className="mt-0.5 h-4 w-4 text-primary" />
              <span>
                <strong>Déjà traité :</strong> {row.returned_done || "rien de signalé"}
              </span>
              <CircleDashed className="mt-0.5 h-4 w-4 text-warning" />
              <span>
                <strong>Reste à faire :</strong> {row.returned_todo}
              </span>
            </div>
          </div>
          <OrgChoice
            label="Réorienter vers"
            candidates={candidates}
            suggestedId={row.suggested_socle_organization_id}
            assignable={assignable}
            value={pick}
            onChange={setPick}
          />
          {routeButton("Réorienter vers")}
        </div>
      )}

      {item.stage === "done" && (
        <div className="flex gap-2.5 rounded-lg bg-primary/5 px-4 py-3.5 text-sm leading-relaxed">
          <Archive className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>
            Clôturé le {fullDate(row.resolved_at)}
            {row.assigned_service && (
              <>
                {" "}
                par <strong>{row.assigned_service}</strong>
              </>
            )}
            .
          </span>
        </div>
      )}

      {item.stage === "analysing" && (
        <div className="flex gap-2.5 rounded-lg bg-muted px-4 py-3.5 text-sm leading-relaxed">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
          <span>
            {row.analysis_status === "running"
              ? "Clara lit le document, identifie l'expéditeur et prépare une proposition de routage."
              : "Ce courrier est en file d'attente d'analyse."}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span className="text-base font-semibold leading-tight">Aperçu</span>
        </div>
        {displayDocuments.length > 0 ? (
          <DocumentViewer
            documents={displayDocuments as never}
            currentId={docId}
            onChange={setDocId}
            organizationId={organizationId}
          />
        ) : (
          <p className="rounded-lg bg-muted px-4 py-6 text-center text-sm text-muted-foreground">Aucun document.</p>
        )}
      </div>
    </div>
  );
}
