import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, UserPlus, ExternalLink, Link2, Link2Off } from "lucide-react";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import {
  contactRelationLines,
  findContactByEmail,
  getContact,
  isContactNotFound,
  type SocleContact,
} from "@/services/socleContactService";
import ContactPicker, { contactDisplay } from "@/components/courier/ContactPicker";
import DuplicateContactsAlert from "@/components/contacts/DuplicateContactsAlert";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
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

// Les champs du participant sont des données du COURRIER (tels que reçus/saisis).
// L'identité de référence vit dans le Socle, via socle_contact_id.
const participantSchema = z.object({
  role: z.enum(["sender", "recipient", "cc"]),
  first_name: z.string().trim().max(200).optional(),
  last_name: z.string().trim().min(1, "Nom obligatoire").max(200),
  email: z.string().trim().email("Email invalide").max(255).or(z.literal("")).optional(),
  phone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  organization: z.string().trim().max(200).optional(),
});

type ParticipantFormValues = z.infer<typeof participantSchema>;

/** Association au contact Socle décidée dans le dialog. */
type ContactLink =
  | { mode: "keep" }
  | { mode: "set"; contact: SocleContact }
  | { mode: "clear" };

interface ParticipantManagerProps {
  courierId: string;
  organizationId: string;
}

export default function ParticipantManager({ courierId, organizationId }: ParticipantManagerProps) {
  const queryClient = useQueryClient();
  const queryKey = ["courier-participants", courierId];
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CourierParticipant | null>(null);
  const [contactLink, setContactLink] = useState<ContactLink>({ mode: "keep" });

  const form = useForm<ParticipantFormValues>({
    resolver: zodResolver(participantSchema),
    defaultValues: { role: "sender", first_name: "", last_name: "", email: "", phone: "", address: "", organization: "" },
  });

  const { data: participants = [], isLoading } = useQuery({
    queryKey,
    queryFn: () => getParticipants(courierId),
    enabled: !!courierId,
  });

  // Fiches référentiel des participants liés (relations affichées dans la table).
  // Best-effort : une fiche introuvable/injoignable → null, sans bloquer la table.
  const linkedIds = Array.from(
    new Set(
      (participants as CourierParticipant[])
        .map((p) => p.socle_contact_id)
        .filter((v): v is string => !!v),
    ),
  );
  const { data: contactsById = {} } = useQuery({
    queryKey: ["participants-contacts", courierId, linkedIds.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        linkedIds.map(async (id) => {
          try {
            return [id, await getContact(organizationId, id)] as const;
          } catch {
            return [id, null] as const;
          }
        }),
      );
      return Object.fromEntries(entries) as Record<string, SocleContact | null>;
    },
    enabled: linkedIds.length > 0,
    staleTime: 30_000,
  });

  // Fiche Socle du participant en cours d'édition (affichage du lien actuel).
  const editingContactId: string | null = editing?.socle_contact_id ?? null;
  const linkedContactQuery = useQuery({
    queryKey: ["socle-contact", organizationId, editingContactId],
    queryFn: () => getContact(organizationId, editingContactId!),
    enabled: dialogOpen && !!editingContactId,
    retry: (count, error) => !isContactNotFound(error) && count < 2,
  });

  const resetAndClose = () => {
    setEditing(null);
    setDialogOpen(false);
    setContactLink({ mode: "keep" });
    form.reset({ role: "sender", first_name: "", last_name: "", email: "", phone: "", address: "", organization: "" });
  };

  const openCreate = () => {
    setEditing(null);
    setContactLink({ mode: "keep" });
    form.reset({ role: "sender", first_name: "", last_name: "", email: "", phone: "", address: "", organization: "" });
    setDialogOpen(true);
  };

  const openEdit = (p: CourierParticipant) => {
    setEditing(p);
    setContactLink({ mode: "keep" });
    form.reset({
      role: p.role,
      first_name: p.first_name ?? "",
      last_name: p.last_name ?? p.name ?? "",
      email: p.email ?? "",
      phone: p.phone ?? "",
      address: p.address ?? "",
      organization: p.organization ?? "",
    });
    setDialogOpen(true);
  };

  function buildFullName(v: ParticipantFormValues) {
    return [v.first_name, v.last_name].filter(Boolean).join(" ").trim() || null;
  }

  /**
   * Détermine le socle_contact_id à enregistrer. Rapprochement automatique par
   * email (best-effort : le Socle indisponible ne bloque jamais l'opération).
   */
  async function resolveContactId(values: ParticipantFormValues, current: string | null): Promise<string | null> {
    if (contactLink.mode === "set") return contactLink.contact.id;
    if (contactLink.mode === "clear") return null;
    if (current) return current;
    if (!values.email?.trim()) return null;
    try {
      const matched = await findContactByEmail(organizationId, values.email);
      return matched?.id ?? null;
    } catch {
      return null;
    }
  }

  const addMutation = useMutation({
    mutationFn: async (values: ParticipantFormValues) => {
      const socle_contact_id = await resolveContactId(values, null);
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
        socle_contact_id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["courier", courierId] });
      toast.success("Participant ajouté");
      resetAndClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: async (values: ParticipantFormValues) => {
      if (!editing) throw new Error("Aucun participant sélectionné");
      const socle_contact_id = await resolveContactId(values, editing.socle_contact_id ?? null);
      return updateParticipant(editing.id, {
        role: values.role,
        name: buildFullName(values),
        first_name: values.first_name || null,
        last_name: values.last_name || null,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        organization: values.organization || null,
        socle_contact_id,
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
    if (editing) updateMutation.mutate(values);
    else addMutation.mutate(values);
  };

  const isPending = addMutation.isPending || updateMutation.isPending;

  // Un participant déjà rattaché au référentiel ne peut plus créer de doublon :
  // l'alerte ne sert que tant qu'aucune fiche n'est associée.
  const watchedValues = form.watch();
  const hasContactLink =
    contactLink.mode === "set" || (contactLink.mode === "keep" && !!editingContactId);

  const linkedContact = linkedContactQuery.data ?? null;
  const linkedContactMissing = linkedContactQuery.isError && isContactNotFound(linkedContactQuery.error);

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
              <TableHead>Prénom</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Téléphone</TableHead>
              <TableHead>Contact référentiel</TableHead>
              <TableHead className="w-[90px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {participants.map((p: CourierParticipant) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Badge variant={roleBadgeVariant[p.role] ?? "outline"}>
                    {roleLabels[p.role] ?? p.role}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{p.last_name ?? p.name ?? "—"}</TableCell>
                <TableCell>{p.first_name ?? "—"}</TableCell>
                <TableCell className="text-sm">{p.email ?? "—"}</TableCell>
                <TableCell className="text-sm">{p.phone ?? "—"}</TableCell>
                <TableCell>
                  {p.socle_contact_id ? (
                    <div className="space-y-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Link
                            to={`/contacts/${p.socle_contact_id}`}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5" /> Fiche
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent>Voir la fiche du contact dans le référentiel</TooltipContent>
                      </Tooltip>
                      {contactsById[p.socle_contact_id] &&
                        contactRelationLines(contactsById[p.socle_contact_id]!).map((line) => (
                          <div key={line.key} className="text-xs text-muted-foreground">
                            {line.text}
                          </div>
                        ))}
                      {contactsById[p.socle_contact_id]?.quartier && (
                        <div className="pt-0.5">
                          <QuartierBadge quartier={contactsById[p.socle_contact_id]!.quartier} />
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
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
                            {p.last_name ?? p.name ?? "Ce participant"} sera retiré du courrier. La fiche
                            du référentiel de contacts, elle, n'est pas supprimée.
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

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && resetAndClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le participant" : "Ajouter un participant"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              {!hasContactLink && (
                <DuplicateContactsAlert
                  organizationId={organizationId}
                  draft={{
                    first_name: watchedValues.first_name,
                    last_name: watchedValues.last_name,
                    email: watchedValues.email,
                    phone: watchedValues.phone,
                  }}
                  onSelect={(contact) => setContactLink({ mode: "set", contact })}
                  selectLabel="Associer"
                />
              )}

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

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="first_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Prénom</FormLabel>
                    <FormControl><Input {...field} value={field.value ?? ""} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="last_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nom / Raison sociale *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

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

              {/* Association au contact du référentiel Socle */}
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <Link2 className="h-4 w-4" /> Contact référentiel
                  </span>
                  {(contactLink.mode === "set" ||
                    (contactLink.mode === "keep" && editingContactId)) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-muted-foreground"
                      onClick={() => setContactLink({ mode: "clear" })}
                    >
                      <Link2Off className="h-3.5 w-3.5" /> Dissocier
                    </Button>
                  )}
                </div>
                {contactLink.mode === "clear" ? (
                  <p className="text-xs text-muted-foreground">
                    Le contact sera dissocié de ce participant (la fiche reste dans le référentiel).
                  </p>
                ) : contactLink.mode === "keep" && editingContactId ? (
                  linkedContactMissing ? (
                    <p className="text-xs text-destructive">
                      Contact introuvable dans le référentiel — vous pouvez le dissocier.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Associé à{" "}
                      <span className="font-medium text-foreground">
                        {linkedContact ? contactDisplay(linkedContact) : "…"}
                      </span>
                    </p>
                  )
                ) : null}
                <ContactPicker
                  organizationId={organizationId}
                  value={contactLink.mode === "set" ? contactLink.contact : null}
                  onChange={(c) => setContactLink(c ? { mode: "set", contact: c } : { mode: "keep" })}
                />
                <p className="text-xs text-muted-foreground">
                  Sans sélection, un rapprochement automatique par email est tenté.
                </p>
              </div>

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
