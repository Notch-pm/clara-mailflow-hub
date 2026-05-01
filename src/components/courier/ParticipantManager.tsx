import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, UserPlus, Building2, HeartHandshake, User } from "lucide-react";
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
import { findMatchingUsager, getUsager, getUsagersByIds, type Usager, type UsagerCategory } from "@/services/usagerService";

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

const categoryLabels: Record<UsagerCategory, string> = {
  citoyen: "Citoyen",
  entreprise: "Entreprise",
  association: "Association",
};

const categoryIcons: Record<UsagerCategory, typeof User> = {
  citoyen: User,
  entreprise: Building2,
  association: HeartHandshake,
};

const participantSchema = z
  .object({
    role: z.enum(["sender", "recipient", "cc"]),
    category: z.enum(["citoyen", "entreprise", "association"]),
    civilite: z.enum(["madame", "monsieur"]).optional().nullable(),
    first_name: z.string().trim().max(200).optional(),
    last_name: z.string().trim().min(1, "Nom obligatoire").max(200),
    email: z.string().trim().email("Email invalide").max(255).or(z.literal("")).optional(),
    phone: z.string().trim().max(50).optional(),
    address: z.string().trim().max(500).optional(),
    organization: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.category !== "citoyen" || (v.first_name && v.first_name.trim().length > 0), {
    message: "Prénom obligatoire pour un citoyen",
    path: ["first_name"],
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
  const [editing, setEditing] = useState<any | null>(null);

  const form = useForm<ParticipantFormValues>({
    resolver: zodResolver(participantSchema),
    defaultValues: { role: "sender", category: "citoyen", civilite: null, first_name: "", last_name: "", email: "", phone: "", address: "", organization: "" },
  });
  const category = form.watch("category");

  const { data: participants = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getParticipants(courierId),
    enabled: !!courierId,
  });

  // Fetch attached usagers (batch query) for nature display
  const usagerIds = Array.from(new Set(participants.map((p: any) => p.usager_id).filter(Boolean)));
  const { data: usagersById = {} } = useQuery({
    queryKey: ["participants-usagers", courierId, usagerIds.join(",")],
    queryFn: () => getUsagersByIds(usagerIds),
    enabled: usagerIds.length > 0,
  });

  const resetAndClose = () => {
    setEditing(null);
    setDialogOpen(false);
    form.reset({ role: "sender", category: "citoyen", civilite: null, first_name: "", last_name: "", email: "", phone: "", address: "", organization: "" });
  };

  const openCreate = () => {
    setEditing(null);
    form.reset({ role: "sender", category: "citoyen", civilite: null, first_name: "", last_name: "", email: "", phone: "", address: "", organization: "" });
    setDialogOpen(true);
  };

  const openEdit = (p: any) => {
    setEditing(p);
    const u = p.usager_id ? usagersById[p.usager_id] : null;
    form.reset({
      role: p.role,
      category: (u?.category as UsagerCategory) ?? "citoyen",
      civilite: (u?.civilite as any) ?? null,
      first_name: p.first_name ?? u?.first_name ?? "",
      last_name: p.last_name ?? u?.last_name ?? p.name ?? "",
      email: p.email ?? "",
      phone: p.phone ?? u?.phone ?? "",
      address: p.address ?? "",
      organization: p.organization ?? "",
    });
    setDialogOpen(true);
  };

  function buildFullName(v: ParticipantFormValues) {
    return [v.first_name, v.last_name].filter(Boolean).join(" ").trim() || null;
  }

  const addMutation = useMutation({
    mutationFn: async (values: ParticipantFormValues) => {
      return addParticipant({
        courier_id: courierId,
        organization_id: organizationId,
        role: values.role,
        name: buildFullName(values),
        first_name: values.first_name || null,
        last_name: values.last_name || null,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        organization: values.organization || null,
        usager_id: null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      queryClient.invalidateQueries({ queryKey: ["usagers"] });
      toast.success("Participant ajouté");
      resetAndClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (values: ParticipantFormValues) => {
      if (!editing) throw new Error("Aucun participant sélectionné");
      const matched = await findMatchingUsager(organizationId, {
        email: values.email,
        phone: values.phone,
      });
      const usager_id = matched?.id ?? editing.usager_id ?? null;
      return updateParticipant(editing.id, {
        role: values.role,
        name: buildFullName(values),
        first_name: values.first_name || null,
        last_name: values.last_name || null,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        organization: values.organization || null,
        usager_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      queryClient.invalidateQueries({ queryKey: ["usagers"] });
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
    if (editing) updateMutation.mutate(values);
    else addMutation.mutate(values);
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
              <TableHead>Nature</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Prénom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Téléphone</TableHead>
              <TableHead className="w-[90px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {participants.map((p: any) => {
              const u = p.usager_id ? usagersById[p.usager_id] : null;
              const cat = u?.category as UsagerCategory | undefined;
              const Icon = cat ? categoryIcons[cat] : null;
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Badge variant={roleBadgeVariant[p.role] ?? "outline"}>
                      {roleLabels[p.role] ?? p.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {cat && Icon ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        {categoryLabels[cat]}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{p.last_name ?? p.name ?? "—"}</TableCell>
                  <TableCell>{p.first_name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.email ?? "—"}</TableCell>
                  <TableCell className="text-sm">{p.phone ?? "—"}</TableCell>
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
                              {p.last_name ?? p.name ?? "Ce participant"} sera retiré du courrier.
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
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && resetAndClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le participant" : "Ajouter un participant"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rôle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="category" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nature</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="citoyen">Citoyen</SelectItem>
                        <SelectItem value="entreprise">Entreprise</SelectItem>
                        <SelectItem value="association">Association</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {category === "citoyen" && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="civilite" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Civilité</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                        <FormControl><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="madame">Madame</SelectItem>
                          <SelectItem value="monsieur">Monsieur</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="first_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Prénom *</FormLabel>
                      <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}

              <FormField control={form.control} name="last_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>{category === "citoyen" ? "Nom *" : "Raison sociale *"}</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="email" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone</FormLabel>
                    <FormControl><Input type="tel" {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="organization" render={({ field }) => (
                <FormItem>
                  <FormLabel>Organisme (libellé libre)</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresse</FormLabel>
                  <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
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
