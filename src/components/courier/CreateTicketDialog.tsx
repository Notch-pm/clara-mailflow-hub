import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listProcedures } from "@/services/procedureService";
import { createTicket } from "@/services/actionTicketService";
import { logEvent } from "@/services/courierEventService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courierId: string;
  organizationId: string;
  /** Optional pre-filled description (e.g. from a suggested action). */
  initialDescription?: string;
}

export default function CreateTicketDialog({
  open,
  onOpenChange,
  courierId,
  organizationId,
  initialDescription = "",
}: Props) {
  const qc = useQueryClient();
  const [procedureId, setProcedureId] = useState<string>("");
  const [description, setDescription] = useState<string>(initialDescription);

  // Sync when dialog reopens with a different initial description
  useEffect(() => {
    if (open) {
      setDescription(initialDescription);
      setProcedureId("");
    }
  }, [open, initialDescription]);

  const { data: procedures, isLoading: loadingProcedures } = useQuery({
    queryKey: ["procedures-displayed", organizationId],
    queryFn: () => listProcedures(organizationId),
    enabled: !!organizationId && open,
  });

  const displayedProcedures = (procedures ?? []).filter((p) => p.is_displayed);

  const createMutation = useMutation({
    mutationFn: async () => {
      const ticket = await createTicket({
        organizationId,
        courierId,
        procedureId,
        description,
      });
      await logEvent(organizationId, courierId, "ticket_created", {
        ticket_id: ticket.id,
        procedure_id: procedureId,
        description: description?.slice(0, 200) || null,
      });
      return ticket;
    },
    onSuccess: () => {
      toast.success("Ticket créé");
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = !!procedureId && !createMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer un ticket d'action</DialogTitle>
          <DialogDescription>
            Sélectionnez la démarche concernée et décrivez l'action attendue. Le ticket
            sera lié à ce courrier de façon permanente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="procedure">Démarche</Label>
            <Select value={procedureId} onValueChange={setProcedureId}>
              <SelectTrigger id="procedure">
                <SelectValue
                  placeholder={
                    loadingProcedures ? "Chargement…" : "Sélectionnez une démarche"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {displayedProcedures.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Aucune démarche disponible
                  </div>
                ) : (
                  displayedProcedures.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Descriptif</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Décrivez l'action à mener…"
              rows={5}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Annuler
          </Button>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Créer le ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
