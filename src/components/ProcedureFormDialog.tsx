import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  createProcedure,
  updateProcedure,
  type Procedure,
} from "@/services/procedureService";

const COLOR_OPTIONS = [
  { value: "#0acf83", label: "Vert" },
  { value: "#ffcd57", label: "Jaune" },
  { value: "#2563eb", label: "Bleu" },
  { value: "#dc2626", label: "Rouge" },
  { value: "#9333ea", label: "Violet" },
  { value: "#ea580c", label: "Orange" },
  { value: "#0891b2", label: "Cyan" },
  { value: "#db2777", label: "Rose" },
];

const emptyForm = { name: "", description: "", color: "#0acf83", icon: "" };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  procedure: Procedure | null;
}

export function ProcedureFormDialog({ open, onOpenChange, orgId, procedure }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (open) {
      setForm(
        procedure
          ? {
              name: procedure.name,
              description: procedure.description ?? "",
              color: procedure.color ?? "#0acf83",
              icon: procedure.icon ?? "",
            }
          : emptyForm
      );
    }
  }, [open, procedure]);

  const createMutation = useMutation({
    mutationFn: () =>
      createProcedure(orgId, {
        name: form.name,
        description: form.description,
        color: form.color,
        icon: form.icon || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedures", orgId] });
      toast.success("Démarche créée");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      updateProcedure(procedure!.id, {
        name: form.name,
        description: form.description,
        color: form.color,
        icon: form.icon || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedures", orgId] });
      toast.success("Démarche mise à jour");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (procedure) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{procedure ? "Modifier la démarche" : "Nouvelle démarche"}</DialogTitle>
          <DialogDescription>
            {procedure
              ? "Modifiez les informations de la démarche."
              : "Créez une nouvelle démarche administrative."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="proc-name">Nom *</Label>
            <Input
              id="proc-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex. Demande de passeport"
              required
              maxLength={150}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="proc-desc">Description</Label>
            <Textarea
              id="proc-desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Description courte de la démarche"
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label>Couleur</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={c.label}
                  onClick={() => setForm({ ...form, color: c.value })}
                  className={`h-8 w-8 rounded-full border-2 transition ${
                    form.color === c.value ? "border-foreground scale-110" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c.value }}
                />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={isPending}>
              Enregistrer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
