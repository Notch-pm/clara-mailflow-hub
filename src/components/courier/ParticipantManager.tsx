import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { getParticipants, addParticipant, updateParticipant, removeParticipant } from "@/services/courierParticipantService";
import type { CourierParticipant } from "@/types/courier";

const ROLES = [
  { value: "sender", label: "Expéditeur" },
  { value: "recipient", label: "Destinataire" },
  { value: "cc", label: "Copie" },
] as const;

const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
  sender: "default",
  recipient: "secondary",
  cc: "outline",
};

const roleLabels: Record<string, string> = {
  sender: "Expéditeur",
  recipient: "Destinataire",
  cc: "Copie",
};

const participantSchema = z.object({
  name: z.string().min(1, "Nom obligatoire").max(200),
  email: z.string().email("Email invalide").max(255).or(z.literal("")).optional(),
  address: z.string().max(500).optional(),
  organization: z.string().max(200).optional(),
  role: z.enum(["sender", "recipient", "cc"], { required_error: "Rôle obligatoire" }),
});

type ParticipantFormValues = z.infer<typeof participantSchema>;

interface ParticipantManagerProps {
  courierId: string;
  organizationId: string;
}

export default function ParticipantManager({ courierId, organizationId }: ParticipantManagerProps) {
  const queryClient = useQueryClient();
  const queryKey = ["courier-participants", courierId];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CourierParticipant | null>(null);

  const form = useForm<ParticipantFormValues>({
    resolver: zodResolver(participantSchema),
    defaultValues: { name: "", email: "", address: "", organization: "", role: "recipient" },
  });

  const { data: participants = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getParticipants(courierId),
    enabled: !!courierId,
  });

  const resetAndClose = () => {
    setEditing(null);
    setDialogOpen(false);
    form.reset({ name: "", email: "", address: "", organization: "", role: "recipient" });
  };

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", email: "", address: "", organization: "", role: "recipient" });
    setDialogOpen(true);
  };

  const openEdit = (p: CourierParticipant) => {
    setEditing(p);
    form.reset({
      name: p.name ?? "",
      email: p.email ?? "",
      address: p.address ?? "",
      organization: p.organization ?? "",
      role: p.role,
    });
    setDialogOpen(true);
  };

  const addMutation = useMutation({
    mutationFn: (values: ParticipantFormValues) =>
      addParticipant({
        courier_id: courierId,
        organization_id: organizationId,
        role: values.role,
        name: values.name || null,
        email: values.email || null,
        address: values.address || null,
        organization: values.organization || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      toast.success("Participant ajouté");
      resetAndClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (values: ParticipantFormValues) => {
      if (!editing) throw new Error("Aucun participant sélectionné");
      return updateParticipant(editing.id, {
        role: values.role,
        name: values.name || null,
        email: values.email || null,
        address: values.address || null,
        organization: values.organization || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      toast.success("Participant mis à jour");
      resetAndClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => removeParticipant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      toast.success("Participant supprimé");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const onSubmit = (values: ParticipantFormValues) => {
    if (editing) {
      updateMutation.mutate(values);
    } else {
      addMutation.mutate(values);
    }
  };

  const isPending = addMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {participants.length} participant{participants.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" className="gap-1.5" onClick={openCreate}>
          <UserPlus className="h-4 w-4" /> Ajouter
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground text-center py-4">Chargement…</p>
      ) : !participants.length ? (
        <div className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-3">Aucun participant.</p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Ajouter le premier participant
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rôle</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Organisation</TableHead>
              <TableHead className="w-[90px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {participants.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Badge variant={roleBadgeVariant[p.role] ?? "outline"}>
                    {roleLabels[p.role] ?? p.role}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{p.name ?? "—"}</TableCell>
                <TableCell className="text-sm">{p.email ?? "—"}</TableCell>
                <TableCell className="text-sm">{p.organization ?? "—"}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(p)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Supprimer ce participant ?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {p.name ?? "Ce participant"} sera retiré du courrier.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMutation.mutate(p.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Supprimer
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && resetAndClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le participant" : "Ajouter un participant"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rôle</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Sélectionner un rôle" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nom</FormLabel>
                  <FormControl><Input placeholder="Nom complet" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="email@exemple.com" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="organization" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organisation</FormLabel>
                    <FormControl><Input placeholder="Nom de l'organisme" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresse</FormLabel>
                  <FormControl><Input placeholder="Adresse postale" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending
                  ? (editing ? "Enregistrement…" : "Ajout…")
                  : (editing ? "Enregistrer" : "Ajouter")}
              </Button>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
