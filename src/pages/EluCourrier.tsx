import { useState } from "react";
import { Building2, ChevronDown, ExternalLink, FileText, Mail, Phone, User } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EluCard } from "@/components/elu/EluCard";
import { EluEmptyState } from "@/components/elu/EluEmptyState";
import { EluScreen, EluScreenHeader } from "@/components/elu/EluScreenHeader";
import { EluStatusPill } from "@/components/elu/EluStatusPill";
import { FilEntry, FilSection } from "@/components/fil/Fil";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useEluCourrier } from "@/hooks/useEluCourrier";
import { useEluCourrierFil } from "@/hooks/useEluCourrierFil";
import { SLA_AXIS_LABELS, formatDay, parisDay, slaLabel } from "@/lib/courier-sla";
import { filMeta } from "@/lib/fil";
import { irisStatusLabel } from "@/lib/iris";
import { readableTextColor } from "@/lib/tag-color";
import { cn } from "@/lib/utils";
import { relationLabel } from "@/services/courierRelationService";
import { TAG_GROUPS } from "@/services/courierTagService";
import { storage } from "@/services/storageService";

const CHANNEL_LABELS: Record<string, string> = {
  email: "par courriel",
  paper: "par courrier papier",
  form: "par formulaire",
  phone: "par téléphone",
  counter: "au guichet",
};

const ROLE_LABELS: Record<string, string> = {
  sender: "Expéditeur",
  recipient: "Destinataire",
  cc: "Copie",
};

function formatDate(value: string | null | undefined): string | null {
  return value ? new Date(value).toLocaleDateString("fr-FR") : null;
}

/** Titre de section de l'écran : même corps que les sections du fil. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-[19px] font-bold text-foreground">
        {title}
        {count !== undefined && count > 0 && (
          <span className="ml-1.5 font-normal text-muted-foreground">({count})</span>
        )}
      </h2>
      {children}
    </section>
  );
}

/**
 * Section repliable, pour ce qui peut être long (texte du courriel, activité) :
 * le titre et le compte restent visibles, rien n'est caché sans qu'on le sache.
 * `<details>` natif : accessible et sans état à tenir.
 */
function Disclosure({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group flex flex-col rounded-xl border bg-card shadow-airbnb-sm">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-[17px] font-bold text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex-1">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-1.5 font-normal text-muted-foreground">({count})</span>
          )}
        </span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="flex flex-col gap-2 border-t px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}

/** Une ligne libellé / valeur de la fiche d'informations. */
function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2.5 last:border-b-0">
      <dt className="text-sm font-bold text-muted-foreground">{label}</dt>
      <dd className="text-base text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default function EluCourrier() {
  const { courierId } = useParams<{ courierId: string }>();
  const { organizationId } = useOrganization();
  const detail = useEluCourrier(courierId);
  const fil = useEluCourrierFil(courierId);
  const [openingDoc, setOpeningDoc] = useState<string | null>(null);

  if (detail.isLoading) {
    return (
      <EluScreen>
        <EluScreenHeader title="Courrier reçu" withBack />
        <EluEmptyState>Chargement…</EluEmptyState>
      </EluScreen>
    );
  }

  if (!detail.courier) {
    return (
      <EluScreen>
        <EluScreenHeader title="Courrier introuvable" withBack />
        <EluEmptyState>Ce courrier n'existe plus, ou ne vous est pas accessible.</EluEmptyState>
      </EluScreen>
    );
  }

  const { courier } = detail;
  const received = courier.received_at ?? courier.created_at;
  const channel = courier.channel ? CHANNEL_LABELS[courier.channel] ?? null : null;
  const meta = [courier.chrono, received ? `reçu le ${formatDate(received)}` : null, channel]
    .filter(Boolean)
    .join(" · ");
  const today = parisDay(new Date())!;

  // La fenêtre s'ouvre AVANT d'attendre l'adresse signée : ouverte après un
  // `await`, Safari iOS la prend pour une fenêtre surgissante et la bloque.
  async function openDocument(doc: { id: string; storage_key: string }) {
    if (!organizationId) return;
    const win = window.open("", "_blank");
    setOpeningDoc(doc.id);
    try {
      const url = await storage.getSignedUrl(organizationId, doc.storage_key);
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch (err) {
      win?.close();
      toast.error(err instanceof Error ? err.message : "Ouverture du document impossible.");
    } finally {
      setOpeningDoc(null);
    }
  }

  return (
    <EluScreen>
      <EluScreenHeader title={courier.subject ?? "Sans objet"} subtitle={meta} withBack />

      {detail.stateName && <EluStatusPill>{detail.stateName}</EluStatusPill>}

      {/* ── L'essentiel : qui, quel service, quoi, comment c'est classé, ce qui
          a été répondu. Le reste suit, dans l'ordre du poste de travail. ── */}

      <Section title="Usager">
        {detail.senderName || detail.senderEmail ? (
          <div className="flex flex-col gap-3 rounded-[--radius] border bg-card p-4 shadow-airbnb-sm">
            <div className="flex items-start gap-3.5">
              <User className="mt-0.5 h-[22px] w-[22px] shrink-0 text-primary" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[17px] font-semibold text-foreground">
                  {detail.senderName ?? detail.senderEmail}
                </span>
                {detail.senderName && detail.senderEmail && (
                  <a
                    href={`mailto:${detail.senderEmail}`}
                    className="flex min-h-9 items-center gap-1.5 break-all text-[15px] text-muted-foreground"
                  >
                    <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {detail.senderEmail}
                  </a>
                )}
                {detail.senderPhone && (
                  <a
                    href={`tel:${detail.senderPhone.replace(/\s+/g, "")}`}
                    className="flex min-h-9 items-center gap-1.5 text-[15px] text-muted-foreground"
                  >
                    <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {detail.senderPhone}
                  </a>
                )}
              </span>
            </div>
            {detail.senderContactId ? (
              <Link
                to={`/elu/usager/${detail.senderContactId}`}
                className="flex min-h-12 items-center justify-center rounded-xl border text-base font-bold text-primary"
              >
                Voir la fiche usager
              </Link>
            ) : (
              <span className="text-[15px] text-muted-foreground">
                Pas encore rattaché à une fiche usager.
              </span>
            )}
          </div>
        ) : (
          <p className="text-base text-muted-foreground">Expéditeur non renseigné.</p>
        )}
      </Section>

      <Section title="Service instructeur">
        <div className="flex items-center gap-3.5 rounded-[--radius] border bg-card p-4 shadow-airbnb-sm">
          <Building2 className="h-[22px] w-[22px] shrink-0 text-primary" aria-hidden="true" />
          <span
            className={cn(
              "text-[17px]",
              detail.serviceName ? "font-semibold text-foreground" : "text-muted-foreground",
            )}
          >
            {detail.serviceName ?? "Pas encore affecté"}
          </span>
        </div>
      </Section>

      {/* Le résumé produit par l'analyse : l'élu juge sur le fond sans ouvrir
          les pièces jointes. */}
      <Section title="Résumé">
        <div className="border-l-[3px] pl-4">
          {detail.summary ? (
            <p className="text-base leading-relaxed text-foreground [text-wrap:pretty]">{detail.summary}</p>
          ) : (
            <p className="text-base text-muted-foreground">
              Ce courrier n'a pas encore été analysé. Son contenu reste lisible plus bas.
            </p>
          )}
        </div>
      </Section>

      <Section title="Tags" count={detail.tagCount}>
        {detail.tagCount === 0 ? (
          <p className="text-base text-muted-foreground">Aucun tag sur ce courrier.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {TAG_GROUPS.map((group) => {
              const applied = detail.tagsByGroup[group.value];
              if (applied.length === 0) return null;
              return (
                <div key={group.value} className="flex flex-col gap-1.5">
                  <span className="text-sm font-bold text-muted-foreground">{group.label}</span>
                  <span className="flex flex-wrap gap-2">
                    {applied.map(({ name, tag }) => (
                      // Couleur du tag : donnée du référentiel, pas du code.
                      <span
                        key={name}
                        className={cn(
                          "inline-flex min-h-8 items-center rounded-full px-3 text-[15px] font-semibold",
                          !tag?.color && "bg-muted text-foreground",
                          !tag && "italic opacity-70",
                        )}
                        style={tag?.color ? { backgroundColor: tag.color, color: readableTextColor(tag.color) } : undefined}
                      >
                        {name}
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {fil.isLoading ? (
        <EluEmptyState>Chargement des réponses…</EluEmptyState>
      ) : fil.isError || !fil.data ? (
        <EluEmptyState>Les réponses de ce courrier sont indisponibles pour le moment.</EluEmptyState>
      ) : (
        <FilSection title="Réponses" count={fil.data.replies.length} empty="Aucune réponse pour l'instant." large>
          {fil.data.replies.map((r) => (
            <li key={r.id} className="list-none">
              <EluCard
                to={`/elu/reponse/${r.id}`}
                title={r.subject ?? "Réponse"}
                meta={[r.at ? `créée le ${formatDate(r.at)}` : null, r.signed ? "signée" : null, r.sent ? "envoyée" : null]
                  .filter(Boolean)
                  .join(" · ")}
                badge={r.stateName ? <EluStatusPill>{r.stateName}</EluStatusPill> : null}
              />
            </li>
          ))}
        </FilSection>
      )}

      {/* ── Le reste du courrier ── */}

      <Section title="Informations">
        <dl className="flex flex-col rounded-[--radius] border bg-card px-4 py-1 shadow-airbnb-sm">
          <InfoRow label="Référence">{courier.chrono ?? "—"}</InfoRow>
          <InfoRow label="Reçu le">{formatDate(received) ?? "—"}</InfoRow>
          <InfoRow label="Canal">{channel ? channel.replace(/^(par|au) /, "") : "—"}</InfoRow>
          <InfoRow label="État">{detail.stateName ?? "—"}</InfoRow>
          <InfoRow label="Destinataire">{detail.recipientName ?? "—"}</InfoRow>
        </dl>
      </Section>

      {detail.sla && (
        <Section title="Délais de traitement">
          <dl className="flex flex-col rounded-[--radius] border bg-card px-4 py-1 shadow-airbnb-sm">
            {(["ack", "resolution"] as const).map((axis) => {
              const status = detail.sla![axis];
              const late = status.kind === "overdue" || status.kind === "missed";
              return (
                <InfoRow key={axis} label={SLA_AXIS_LABELS[axis]}>
                  <span className={cn(late && "font-semibold text-destructive")}>{slaLabel(status, today)}</span>
                  {status.dueDay && (
                    <span className="block text-[15px] text-muted-foreground">
                      Échéance : {formatDay(status.dueDay)}
                    </span>
                  )}
                </InfoRow>
              );
            })}
          </dl>
        </Section>
      )}

      <Section title="Pièces jointes" count={detail.documents.length}>
        {detail.documents.length === 0 ? (
          <p className="text-base text-muted-foreground">Aucune pièce jointe.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.documents.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => void openDocument(doc)}
                disabled={openingDoc === doc.id}
                className="flex min-h-14 items-center gap-3 rounded-xl border bg-card px-4 text-left text-[17px] text-foreground disabled:opacity-60"
              >
                <FileText className="h-[22px] w-[22px] shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 break-words">{doc.file_name ?? "Document sans nom"}</span>
                <ExternalLink className="h-[18px] w-[18px] shrink-0 text-primary" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </Section>

      {detail.bodyText && (
        <Disclosure title="Texte du courriel">
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">
            {detail.bodyText}
          </p>
        </Disclosure>
      )}

      <Section title="Actions liées" count={detail.tickets.length}>
        {detail.tickets.length === 0 ? (
          <p className="text-base text-muted-foreground">Aucune action liée.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.tickets.map((t) => {
              const title = t.procedure?.name ?? t.title ?? "Action";
              const metaLine = [
                t.iris_reference ?? t.arpege_demande_ref,
                irisStatusLabel(t.iris_status) ?? t.arpege_demande_status,
                `créée le ${formatDate(t.created_at)}`,
              ]
                .filter(Boolean)
                .join(" · ");
              // Une démarche déposée dans Iris s'ouvre dans l'espace élu ; une
              // action interne se lit telle quelle.
              return t.iris_request_id ? (
                <EluCard key={t.id} to={`/elu/demande/${t.iris_request_id}`} title={title} meta={metaLine} />
              ) : (
                <div key={t.id} className="flex flex-col gap-1.5 rounded-xl border bg-card p-4 shadow-airbnb-sm">
                  <span className="text-[17px] font-semibold leading-snug text-foreground">{title}</span>
                  <span className="text-[15px] text-muted-foreground">{metaLine}</span>
                  {t.iris_last_error && (
                    <span className="text-[15px] text-destructive">Non transmise à Iris : {t.iris_last_error}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {detail.suggestedActions.length > 0 && (
        <Section title="Actions suggérées par l'analyse" count={detail.suggestedActions.length}>
          <ul className="flex flex-col gap-2">
            {detail.suggestedActions.map((a, i) => (
              <li key={`${a.label}-${i}`} className="flex flex-col gap-0.5 rounded-xl border bg-card p-4">
                <span className="text-base font-semibold text-foreground">{a.label}</span>
                {(a.procedure_name || a.socle_organization_name) && (
                  <span className="text-[15px] text-muted-foreground">
                    {[a.procedure_name, a.socle_organization_name].filter(Boolean).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Courriers liés" count={detail.relations.length}>
        {detail.relations.length === 0 ? (
          <p className="text-base text-muted-foreground">Aucun courrier lié.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.relations.map((rel) => {
              const other = rel.related;
              const label = relationLabel(rel).title;
              if (!other) {
                return (
                  <p key={rel.id} className="text-base text-muted-foreground">
                    {label} : courrier inaccessible.
                  </p>
                );
              }
              const outbound = other.direction === "outbound";
              const date = outbound ? other.sent_at : other.received_at;
              return (
                <EluCard
                  key={rel.id}
                  to={outbound ? `/elu/reponse/${other.id}` : `/elu/courrier/${other.id}`}
                  title={other.subject ?? "Sans objet"}
                  meta={[label, other.chrono, date ? formatDate(date) : null].filter(Boolean).join(" · ")}
                />
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Participants" count={detail.participants.length}>
        {detail.participants.length === 0 ? (
          <p className="text-base text-muted-foreground">Aucun participant.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.participants.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border bg-card p-4">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm font-bold text-muted-foreground">{ROLE_LABELS[p.role] ?? p.role}</span>
                  <span className="break-words text-base font-semibold text-foreground">
                    {p.name ?? p.email ?? "Sans nom"}
                  </span>
                  {p.name && p.email && <span className="break-all text-[15px] text-muted-foreground">{p.email}</span>}
                </span>
                {p.socle_contact_id && (
                  <Link
                    to={`/elu/usager/${p.socle_contact_id}`}
                    className="flex min-h-11 shrink-0 items-center text-base font-bold text-primary"
                  >
                    Fiche
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Le fil : commentaires des agents, puis l'historique — replié, il peut
          compter des dizaines d'entrées. */}
      {fil.data && (
        <>
          <FilSection title="Commentaires internes" count={fil.data.notes.length} empty="Aucun commentaire interne." large>
            {fil.data.notes.map((n) => (
              <FilEntry key={n.id} large title={n.by ?? "Agent"} body={n.content} meta={filMeta(n.at)} />
            ))}
          </FilSection>

          <Disclosure title="Historique" count={fil.data.activity.length}>
            {fil.data.activity.length === 0 ? (
              <p className="text-base text-muted-foreground">Aucune activité enregistrée.</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {fil.data.activity.map((a) => (
                  <FilEntry key={a.id} large title={a.title} detail={a.detail} meta={filMeta(a.at, a.by)} />
                ))}
              </ol>
            )}
          </Disclosure>
        </>
      )}
    </EluScreen>
  );
}
