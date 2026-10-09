import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getOrgMembers } from "@/services/userService";
import { createTask, sendTaskMail, type TaskAssignee } from "@/services/actionTicketService";
import { logEvent } from "@/services/courierEventService";
import { isValidTaskEmail } from "@/lib/action-task";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courierId: string;
  organizationId: string;
  /** Intitulé proposé (action suggérée par l'analyse), modifiable. */
  initialTitle?: string | null;
}

type AssigneeMode = "membre" | "adresse";

const TITLE_MAX = 200;

/**
 * Tâche : action interne, jamais transmise à Iris ni à un partenaire. L'agent
 * affecté — membre de Clara ou simple adresse — la reçoit par mail avec un lien
 * pour la marquer terminée sans se connecter.
 */
export default function CreateTaskDialog({
  open,
  onOpenChange,
  courierId,
  organizationId,
  initialTitle = null,
}: Props) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<AssigneeMode>("membre");
  const [memberId, setMemberId] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle((initialTitle ?? "").trim().slice(0, TITLE_MAX));
    setDescription("");
    setMode("membre");
    setMemberId("");
    setEmail("");
    setName("");
  }, [open, initialTitle]);

  const { data: members = [], isLoading: loadingMembers } = useQuery({
    queryKey: ["org-members-tasks", organizationId],
    queryFn: () => getOrgMembers(organizationId),
    enabled: open && !!organizationId,
  });

  const activeMembers = useMemo(
    () =>
      members
        .filter((m) => m.membership_active !== false && m.is_active !== false && m.email !== "—")
        .map((m) => ({
          ...m,
          label: [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || m.email,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "fr")),
    [members],
  );

  const assignee: TaskAssignee | null = useMemo(() => {
    if (mode === "membre") {
      const m = activeMembers.find((x) => x.id === memberId);
      return m ? { userId: m.id, email: m.email, name: m.label } : null;
    }
    return isValidTaskEmail(email) ? { userId: null, email: email.trim(), name: name.trim() || null } : null;
  }, [mode, activeMembers, memberId, email, name]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!assignee) throw new Error("Agent affecté manquant");
      const created = await createTask({ organizationId, courierId, title, description, assignee });
      await logEvent(organizationId, courierId, "task_created", {
        ticket_id: created.id,
        title: created.title,
        assignee_name: assignee.name ?? assignee.email,
      });
      try {
        return await sendTaskMail(created.id, "notify");
      } catch (e) {
        return { mailed: false, notified: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    onSuccess: (result) => {
      if (result.mailed) {
        toast.success("Tâche créée — l'agent affecté a été prévenu par mail");
      } else {
        toast.warning(
          "Tâche créée, mais le mail n'est pas parti (serveur d'envoi absent ou refusé). Utilisez « Relancer » plus tard.",
        );
      }
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emailInvalid = mode === "adresse" && email.trim() !== "" && !isValidTaskEmail(email);
  const canSubmit = !saveMutation.isPending && title.trim() !== "" && !!assignee;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouvelle tâche</DialogTitle>
          <DialogDescription>
            Action interne, non transmise à Iris ni à un partenaire. L'agent affecté reçoit un mail
            pour la marquer terminée.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="task-title">
              Intitulé<span className="text-destructive ml-0.5">*</span>
            </Label>
            <Input
              id="task-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={TITLE_MAX}
              placeholder="Ex. : vérifier l'état du trottoir rue des Lilas"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="task-description">Commentaire</Label>
            <Textarea
              id="task-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Précisions utiles à l'agent (facultatif)"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Agent affecté<span className="text-destructive ml-0.5">*</span>
            </Label>
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as AssigneeMode)}
              className="justify-start"
              size="sm"
              variant="outline"
            >
              <ToggleGroupItem value="membre">Utilisateur de Clara</ToggleGroupItem>
              <ToggleGroupItem value="adresse">Autre adresse mail</ToggleGroupItem>
            </ToggleGroup>

            {mode === "membre" ? (
              <Select value={memberId} onValueChange={setMemberId} disabled={loadingMembers}>
                <SelectTrigger aria-label="Agent affecté">
                  <SelectValue placeholder={loadingMembers ? "Chargement…" : "Choisir un agent…"} />
                </SelectTrigger>
                <SelectContent>
                  {activeMembers.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                      {m.label !== m.email && (
                        <span className="text-muted-foreground"> — {m.email}</span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Input
                    type="email"
                    aria-label="Adresse mail de l'agent"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="prenom.nom@exemple.fr"
                    aria-invalid={emailInvalid}
                  />
                  {emailInvalid && (
                    <p className="text-[11px] text-destructive">Adresse mail invalide.</p>
                  )}
                </div>
                <Input
                  aria-label="Nom de l'agent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nom (facultatif)"
                  maxLength={120}
                />
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!canSubmit}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Créer et envoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
