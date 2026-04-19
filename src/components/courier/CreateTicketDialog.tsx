import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Check, ChevronsUpDown, X } from "lucide-react";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { listProcedures } from "@/services/procedureService";
import { createTicket, updateTicket, type ActionTicketWithProcedure } from "@/services/actionTicketService";
import { logEvent } from "@/services/courierEventService";
import { getOrgMembers } from "@/services/userService";
import { UserAvatar } from "@/components/UserAvatar";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courierId: string;
  organizationId: string;
  /** Optional pre-filled description (e.g. from a suggested action). */
  initialDescription?: string;
  /** When provided, switches the dialog to edit mode for that ticket. */
  ticket?: ActionTicketWithProcedure | null;
}

export default function CreateTicketDialog({
  open,
  onOpenChange,
  courierId,
  organizationId,
  initialDescription = "",
  ticket = null,
}: Props) {
  const qc = useQueryClient();
  const isEdit = !!ticket;
  const [procedureId, setProcedureId] = useState<string>("");
  const [description, setDescription] = useState<string>(initialDescription);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [procedurePopoverOpen, setProcedurePopoverOpen] = useState(false);
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);

  // Sync when dialog reopens
  useEffect(() => {
    if (open) {
      if (isEdit && ticket) {
        setDescription(ticket.description ?? "");
        setProcedureId(ticket.procedure_id);
        setAssigneeId(ticket.assignee_id ?? null);
      } else {
        setDescription(initialDescription);
        setProcedureId("");
        setAssigneeId(null);
      }
    }
  }, [open, initialDescription, isEdit, ticket]);

  const { data: procedures, isLoading: loadingProcedures } = useQuery({
    queryKey: ["procedures-displayed", organizationId],
    queryFn: () => listProcedures(organizationId),
    enabled: !!organizationId && open,
  });

  const displayedProcedures = (procedures ?? []).filter((p) => p.is_displayed);
  const selectedProcedure = displayedProcedures.find((p) => p.id === procedureId);

  const { data: members, isLoading: loadingMembers } = useQuery({
    queryKey: ["org-members", organizationId],
    queryFn: () => getOrgMembers(organizationId),
    enabled: !!organizationId && open,
  });

  const activeMembers = (members ?? []).filter(
    (m) => m.is_active !== false && m.membership_active !== false,
  );
  const selectedAssignee = activeMembers.find((m) => m.id === assigneeId) ?? null;

  const fullName = (m: { first_name: string | null; last_name: string | null; email: string }) =>
    [m.first_name, m.last_name].filter(Boolean).join(" ") || m.email;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isEdit && ticket) {
        await updateTicket(ticket.id, {
          description,
          assigneeId,
          procedureId,
        });
        await logEvent(organizationId, courierId, "ticket_updated", {
          ticket_id: ticket.id,
          procedure_id: procedureId,
          assignee_id: assigneeId,
        });
        return ticket;
      }
      const created = await createTicket({
        organizationId,
        courierId,
        procedureId,
        description,
        assigneeId,
      });
      await logEvent(organizationId, courierId, "ticket_created", {
        ticket_id: created.id,
        procedure_id: procedureId,
        assignee_id: assigneeId,
        description: description?.slice(0, 200) || null,
      });
      return created;
    },
    onSuccess: () => {
      toast.success(isEdit ? "Ticket modifié" : "Ticket créé");
      qc.invalidateQueries({ queryKey: ["action-tickets", courierId] });
      qc.invalidateQueries({ queryKey: ["courier-events", courierId] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSubmit = !!procedureId && !saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier le ticket d'action" : "Créer un ticket d'action"}</DialogTitle>
          <DialogDescription>
            Sélectionnez la démarche concernée, l'utilisateur en charge et décrivez l'action attendue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="procedure">Démarche</Label>
            <Popover open={procedurePopoverOpen} onOpenChange={setProcedurePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="procedure"
                  variant="outline"
                  role="combobox"
                  aria-expanded={procedurePopoverOpen}
                  className="w-full justify-between"
                  disabled={loadingProcedures}
                >
                  {selectedProcedure
                    ? selectedProcedure.name
                    : loadingProcedures
                      ? "Chargement…"
                      : "Sélectionnez une démarche"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                <Command>
                  <CommandInput placeholder="Rechercher une démarche…" />
                  <CommandList>
                    <CommandEmpty>Aucune démarche trouvée</CommandEmpty>
                    <CommandGroup>
                      {displayedProcedures.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={p.name}
                          onSelect={() => {
                            setProcedureId(p.id);
                            setProcedurePopoverOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              procedureId === p.id ? "opacity-100" : "opacity-0",
                            )}
                          />
                          {p.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="assignee">Affecté à</Label>
            <div className="flex items-center gap-2">
              <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="assignee"
                    variant="outline"
                    role="combobox"
                    aria-expanded={assigneePopoverOpen}
                    className="flex-1 justify-between"
                    disabled={loadingMembers}
                  >
                    {selectedAssignee ? (
                      <span className="flex items-center gap-2">
                        <UserAvatar
                          firstName={selectedAssignee.first_name}
                          lastName={selectedAssignee.last_name}
                          email={selectedAssignee.email}
                          avatarUrl={selectedAssignee.avatar_url}
                          className="h-5 w-5"
                        />
                        {fullName(selectedAssignee)}
                      </span>
                    ) : loadingMembers ? (
                      "Chargement…"
                    ) : (
                      "Aucun (non affecté)"
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Rechercher un utilisateur…" />
                    <CommandList>
                      <CommandEmpty>Aucun utilisateur trouvé</CommandEmpty>
                      <CommandGroup>
                        {activeMembers.map((m) => (
                          <CommandItem
                            key={m.id}
                            value={`${fullName(m)} ${m.email}`}
                            onSelect={() => {
                              setAssigneeId(m.id);
                              setAssigneePopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                assigneeId === m.id ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <UserAvatar
                              firstName={m.first_name}
                              lastName={m.last_name}
                              email={m.email}
                              avatarUrl={m.avatar_url}
                              className="h-6 w-6 mr-2"
                            />
                            <span className="flex-1">{fullName(m)}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedAssignee && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setAssigneeId(null)}
                  title="Retirer l'affectation"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
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
            disabled={saveMutation.isPending}
          >
            Annuler
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!canSubmit}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Enregistrer" : "Créer le ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
