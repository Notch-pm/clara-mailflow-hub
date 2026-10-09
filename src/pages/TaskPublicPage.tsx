import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, ListChecks, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TASK_COMPLETION_NOTE_MAX } from "@/lib/action-task";
import {
  completePublicTask,
  getPublicTask,
  PublicTaskError,
  type PublicTaskView,
} from "@/services/actionTaskPublicService";

/**
 * Page publique ouverte depuis le mail d'une tâche (/tache/:token) : l'agent
 * affecté — utilisateur de Clara ou non — la marque terminée sans se connecter.
 * Contenu MINIMAL, voulu : ni objet du courrier, ni usager, ni pièces. Ouvrir
 * la page ne modifie rien (les scanners de liens des messageries l'ouvrent
 * aussi) : seul le bouton clôt la tâche.
 */
type Status = "loading" | "ready" | "submitting" | "invalid" | "error";

function formatDate(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? null
    : d.toLocaleString("fr-FR", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TaskPublicPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<PublicTaskView | null>(null);
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Tâche — Clara";
    getPublicTask(token)
      .then((v) => {
        setView(v);
        setStatus("ready");
      })
      .catch((e) => setStatus(e instanceof PublicTaskError && e.status === 404 ? "invalid" : "error"));
  }, [token]);

  async function handleComplete() {
    setStatus("submitting");
    setSubmitError(null);
    try {
      setView(await completePublicTask(token, note));
      setStatus("ready");
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Une erreur est survenue.");
      setStatus("ready");
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (status === "invalid") {
    return (
      <PageShell>
        <StateBlock icon={<AlertCircle className="h-10 w-10 text-destructive" />} title="Lien introuvable">
          Ce lien n'est pas valide, ou la tâche a été supprimée. Si la tâche a été rouverte, utilisez le lien du
          dernier mail reçu.
        </StateBlock>
      </PageShell>
    );
  }
  if (status === "error" || !view) {
    return (
      <PageShell>
        <StateBlock icon={<AlertCircle className="h-10 w-10 text-destructive" />} title="Erreur">
          Une erreur est survenue lors du chargement. Veuillez réessayer ultérieurement.
        </StateBlock>
      </PageShell>
    );
  }

  const { task, organization } = view;
  const done = task.status === "done";
  const submitting = status === "submitting";

  return (
    <PageShell>
      <div className="w-full max-w-lg mx-auto space-y-6">
        <div className="space-y-1">
          {organization.name && (
            <p className="text-sm font-medium text-muted-foreground">{organization.name}</p>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-start gap-2">
            <ListChecks className="h-6 w-6 mt-1 shrink-0 text-primary" />
            <span className="break-words">{task.title}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {[
              task.author_name ? `Confiée par ${task.author_name}` : null,
              task.assignee_name ? `à ${task.assignee_name}` : null,
              task.courier_chrono ? `— courrier ${task.courier_chrono}` : null,
            ]
              .filter(Boolean)
              .join(" ")}
          </p>
        </div>

        {task.description && (
          <div className="rounded-lg border bg-card p-4">
            <p className="text-sm whitespace-pre-wrap break-words text-foreground">{task.description}</p>
          </div>
        )}

        {done ? (
          <div className="rounded-lg border border-success/30 bg-success/10 p-4 space-y-1">
            <p className="flex items-center gap-2 font-semibold text-foreground">
              <CheckCircle2 className="h-5 w-5 text-success" />
              Tâche terminée
            </p>
            <p className="text-sm text-muted-foreground">
              {formatDate(task.completed_at) ? `Le ${formatDate(task.completed_at)}.` : null} Merci, l'équipe qui
              suit le courrier en est informée.
            </p>
            {task.completion_note && (
              <p className="text-sm whitespace-pre-wrap break-words text-foreground pt-1">« {task.completion_note} »</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="note">
                Note <span className="text-muted-foreground text-xs">(facultatif)</span>
              </Label>
              <Textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={TASK_COMPLETION_NOTE_MAX}
                rows={3}
                placeholder="Ce qui a été fait, à l'attention de l'équipe qui suit le courrier"
                disabled={submitting}
              />
            </div>
            {submitError && <p className="text-sm text-destructive">{submitError}</p>}
            <Button className="w-full" size="lg" onClick={handleComplete} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Marquer comme terminée
            </Button>
          </div>
        )}

        {task.courier_id && (
          <p className="text-center text-sm">
            <a
              href={`/courrier/${task.courier_id}?tab=actions`}
              className="text-primary underline underline-offset-2 hover:opacity-80"
            >
              Ouvrir le courrier dans Clara
            </a>
          </p>
        )}
      </div>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-start bg-background px-4 py-12">{children}</div>
  );
}

function StateBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center max-w-sm">
      {icon}
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
