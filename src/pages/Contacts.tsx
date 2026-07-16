import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  HeartHandshake,
  Landmark,
  Pencil,
  Plus,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { buildCsv, downloadCsv, type CsvColumn } from "@/components/data-table/csv-export";
import {
  archiveContact,
  createContact,
  fetchAllContactsForExport,
  getContact,
  isContactNotFound,
  listContactRoles,
  listContacts,
  RELATION_STRUCTURE_TYPES,
  relationTargetTypes,
  restoreContact,
  SOCLE_CONTACT_TYPE_LABELS,
  updateContact,
  type SocleContact,
  type SocleContactInput,
  type SocleContactRelationInput,
  type SocleContactType,
} from "@/services/socleContactService";
import { listContactCouriers, type ContactCourier } from "@/services/courierParticipantService";
import ContactPicker from "@/components/courier/ContactPicker";

/**
 * Annuaire des contacts — données servies par le référentiel Socle (source de
 * vérité). Clara n'affiche et ne modifie les fiches qu'à travers l'API du
 * Socle ; seuls les courriers liés (référence socle_contact_id) sont des
 * données Clara.
 */

const typeIcons: Record<SocleContactType, typeof User> = {
  personne: User,
  entreprise: Building2,
  association: HeartHandshake,
  administration: Landmark,
};

const PAGE_SIZE = 100;

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

function contactPhone(c: SocleContact): string {
  return c.mobile_phone || c.landline_phone || "—";
}

// ── Formulaire création / édition ──────────────────────────────────────────

const formSchema = z
  .object({
    contact_type: z.enum(["personne", "entreprise", "association", "administration"]),
    civility: z.enum(["madame", "monsieur"]).optional().nullable(),
    first_name: z.string().trim().max(200).optional(),
    last_name: z.string().trim().max(200).optional(),
    usage_name: z.string().trim().max(200).optional(),
    birth_date: z.string().trim().optional(),
    legal_name: z.string().trim().max(300).optional(),
    siret: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || /^\d{14}$/.test(v.replace(/\s/g, "")), "SIRET : 14 chiffres attendus"),
    email: z.string().trim().email("Email invalide").max(255).or(z.literal("")).optional(),
    mobile_phone: z.string().trim().max(50).optional(),
    landline_phone: z.string().trim().max(50).optional(),
    address_line1: z.string().trim().max(300).optional(),
    address_line2: z.string().trim().max(300).optional(),
    postal_code: z.string().trim().max(20).optional(),
    city: z.string().trim().max(200).optional(),
    preferred_channel: z.enum(["email", "telephone", "courrier"]).optional().nullable(),
    consent_email: z.boolean().optional(),
    consent_sms: z.boolean().optional(),
    internal_notes: z.string().trim().max(5000).optional(),
  })
  .superRefine((values, ctx) => {
    if (values.contact_type === "personne") {
      if (!values.civility) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["civility"], message: "Civilité obligatoire pour une personne" });
      }
      if (!values.last_name?.trim()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["last_name"], message: "Nom obligatoire" });
      }
    } else if (!values.legal_name?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["legal_name"], message: "Raison sociale obligatoire" });
    }
  });

type FormValues = z.infer<typeof formSchema>;

function contactToFormValues(contact: SocleContact | null): FormValues {
  return {
    contact_type: contact?.contact_type ?? "personne",
    civility: contact?.civility ?? null,
    first_name: contact?.first_name ?? "",
    last_name: contact?.last_name ?? "",
    usage_name: contact?.usage_name ?? "",
    birth_date: contact?.birth_date ?? "",
    legal_name: contact?.legal_name ?? "",
    siret: contact?.siret ?? "",
    email: contact?.email ?? "",
    mobile_phone: contact?.mobile_phone ?? "",
    landline_phone: contact?.landline_phone ?? "",
    address_line1: contact?.address_line1 ?? "",
    address_line2: contact?.address_line2 ?? "",
    postal_code: contact?.postal_code ?? "",
    city: contact?.city ?? "",
    preferred_channel: contact?.preferred_channel ?? null,
    consent_email: contact?.consent_email ?? false,
    consent_sms: contact?.consent_sms ?? false,
    internal_notes: contact?.internal_notes ?? "",
  };
}

function formValuesToPayload(values: FormValues): SocleContactInput {
  const isPerson = values.contact_type === "personne";
  return {
    contact_type: values.contact_type,
    civility: isPerson ? (values.civility ?? null) : null,
    first_name: isPerson ? values.first_name?.trim() || null : null,
    last_name: isPerson ? values.last_name?.trim() || null : null,
    usage_name: isPerson ? values.usage_name?.trim() || null : null,
    birth_date: isPerson ? values.birth_date?.trim() || null : null,
    legal_name: !isPerson ? values.legal_name?.trim() || null : null,
    siret: !isPerson ? values.siret?.replace(/\s/g, "") || null : null,
    email: values.email?.trim() || null,
    mobile_phone: values.mobile_phone?.trim() || null,
    landline_phone: values.landline_phone?.trim() || null,
    address_line1: values.address_line1?.trim() || null,
    address_line2: values.address_line2?.trim() || null,
    postal_code: values.postal_code?.trim() || null,
    city: values.city?.trim() || null,
    preferred_channel: values.preferred_channel ?? null,
    consent_email: values.consent_email ?? false,
    consent_sms: values.consent_sms ?? false,
    internal_notes: values.internal_notes?.trim() || null,
  };
}

interface ContactFormDialogProps {
  organizationId: string;
  contact: SocleContact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (contact: SocleContact) => void;
}

function ContactFormDialog({ organizationId, contact, open, onOpenChange, onSaved }: ContactFormDialogProps) {
  const isEdit = contact !== null;
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: contactToFormValues(contact),
  });
  const contactType = form.watch("contact_type");
  const isPerson = contactType === "personne";

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = formValuesToPayload(values);
      if (isEdit) {
        // contact_type est immuable côté Socle : on ne l'envoie pas en PATCH.
        const { contact_type: _omit, ...patch } = payload;
        return updateContact(organizationId, contact.id, patch);
      }
      return createContact(organizationId, payload);
    },
    onSuccess: (saved) => {
      toast.success(isEdit ? "Contact mis à jour dans le référentiel" : "Contact créé dans le référentiel");
      onOpenChange(false);
      onSaved(saved);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'enregistrement du contact");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Modifier le contact" : "Nouveau contact"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="contact_type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={isEdit}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(SOCLE_CONTACT_TYPE_LABELS).map(([type, label]) => (
                        <SelectItem key={type} value={type}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isPerson ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="civility"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Civilité *</FormLabel>
                        <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="madame">Madame</SelectItem>
                            <SelectItem value="monsieur">Monsieur</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="first_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prénom</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="last_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nom de naissance *</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="usage_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nom d'usage</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="birth_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Date de naissance</FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="legal_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Raison sociale *</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="siret"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SIRET</FormLabel>
                      <FormControl><Input {...field} placeholder="14 chiffres" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="preferred_channel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Canal préféré</FormLabel>
                    <Select value={field.value ?? undefined} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="telephone">Téléphone</SelectItem>
                        <SelectItem value="courrier">Courrier</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="mobile_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone mobile</FormLabel>
                    <FormControl><Input type="tel" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="landline_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone fixe</FormLabel>
                    <FormControl><Input type="tel" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address_line1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Adresse</FormLabel>
                  <FormControl><Input {...field} placeholder="N° et voie" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address_line2"
              render={({ field }) => (
                <FormItem>
                  <FormControl><Input {...field} placeholder="Complément d'adresse" /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="postal_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code postal</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ville</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="consent_email"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel className="font-normal">Accepte les mails</FormLabel>
                    <FormControl>
                      <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="consent_sms"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel className="font-normal">Accepte les SMS</FormLabel>
                    <FormControl>
                      <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="internal_notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes internes (agents uniquement)</FormLabel>
                  <FormControl><Textarea rows={3} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? "Enregistrement…" : isEdit ? "Enregistrer" : "Créer le contact"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Relations entre contacts ────────────────────────────────────────────────

interface ContactRelationsCardProps {
  organizationId: string;
  contact: SocleContact;
  onUpdated: (saved: SocleContact) => void;
}

/**
 * Relations du contact dans le référentiel, dans les deux sens : « est
 * <rôle> de <contact> » (éditable ici) et « <contact> est <rôle> de ce
 * contact » (se gère depuis la fiche de l'autre contact).
 */
function ContactRelationsCard({ organizationId, contact, onUpdated }: ContactRelationsCardProps) {
  const navigate = useNavigate();
  const [newRoleId, setNewRoleId] = useState("");
  const [newTarget, setNewTarget] = useState<SocleContact | null>(null);

  const rolesQuery = useQuery({
    queryKey: ["socle-contact-roles", organizationId],
    queryFn: () => listContactRoles(organizationId),
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: (relations: SocleContactRelationInput[]) =>
      updateContact(organizationId, contact.id, { relations }),
    onSuccess: (saved) => {
      onUpdated(saved);
      setNewRoleId("");
      setNewTarget(null);
      toast.success("Relations mises à jour");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  });

  const currentSet = (): SocleContactRelationInput[] =>
    (contact.relations ?? []).map((r) => ({ related_contact_id: r.contact.id, role_id: r.role.id }));

  // La cible d'une relation dépend du rôle (Gérant → entreprise, Agent →
  // administration…) et n'est jamais une personne physique.
  const roles = rolesQuery.data ?? [];
  const selectedRole = roles.find((r) => r.id === newRoleId) ?? null;
  const targetTypes = selectedRole ? relationTargetTypes(selectedRole.name) : RELATION_STRUCTURE_TYPES;

  function handleRoleChange(roleId: string) {
    setNewRoleId(roleId);
    const role = roles.find((r) => r.id === roleId);
    if (role && newTarget && !relationTargetTypes(role.name).includes(newTarget.contact_type)) {
      setNewTarget(null);
    }
  }

  function addRelation() {
    if (!newRoleId || !newTarget) return;
    if (newTarget.id === contact.id) {
      toast.error("Un contact ne peut pas avoir de relation avec lui-même");
      return;
    }
    mutation.mutate([...currentSet(), { related_contact_id: newTarget.id, role_id: newRoleId }]);
  }

  function removeRelation(relationId: string) {
    mutation.mutate(
      (contact.relations ?? [])
        .filter((r) => r.id !== relationId)
        .map((r) => ({ related_contact_id: r.contact.id, role_id: r.role.id })),
    );
  }

  const outgoing = contact.relations ?? [];
  const incoming = contact.reverse_relations ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Relations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {outgoing.length === 0 && incoming.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune relation avec un autre contact.</p>
        )}

        {outgoing.length > 0 && (
          <div className="space-y-1.5">
            {outgoing.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <span>
                  Est <span className="font-medium">{r.role.name}</span> de{" "}
                  <button
                    type="button"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                    onClick={() => navigate(`/contacts/${r.contact.id}`)}
                  >
                    {r.contact.display_name ?? "—"}
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive ml-auto"
                  aria-label="Retirer cette relation"
                  disabled={mutation.isPending}
                  onClick={() => removeRelation(r.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {incoming.length > 0 && (
          <div className="space-y-1.5">
            {incoming.map((r) => (
              <div key={r.id} className="text-sm">
                <button
                  type="button"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                  onClick={() => navigate(`/contacts/${r.contact.id}`)}
                >
                  {r.contact.display_name ?? "—"}
                  <ExternalLink className="h-3 w-3" />
                </button>{" "}
                est <span className="font-medium">{r.role.name}</span> de ce contact
                <span className="text-xs text-muted-foreground"> (se modifie depuis sa fiche)</span>
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Est…</div>
            <Select value={newRoleId || undefined} onValueChange={handleRoleChange}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Rôle" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[220px]">
            <div className="text-xs text-muted-foreground">
              de… {selectedRole
                ? `(${targetTypes.map((t) => SOCLE_CONTACT_TYPE_LABELS[t].toLowerCase()).join(", ")})`
                : "(choisissez d'abord un rôle)"}
            </div>
            <ContactPicker
              organizationId={organizationId}
              value={newTarget}
              onChange={setNewTarget}
              types={targetTypes}
              disabled={!selectedRole}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!newRoleId || !newTarget || mutation.isPending}
            onClick={addRelation}
          >
            <Plus className="h-4 w-4 mr-1" /> Ajouter
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Fiche contact ───────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value?.trim() || "—"}</div>
    </div>
  );
}

function ContactDetail({ contactId }: { contactId: string }) {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const contactQuery = useQuery({
    queryKey: ["socle-contact", organizationId, contactId],
    queryFn: () => getContact(organizationId!, contactId),
    enabled: !!organizationId,
    retry: (count, error) => !isContactNotFound(error) && count < 2,
  });

  const couriersQuery = useQuery({
    queryKey: ["socle-contact-couriers", contactId],
    queryFn: () => listContactCouriers(contactId),
  });

  const archiveMutation = useMutation({
    mutationFn: async (archive: boolean) =>
      archive ? archiveContact(organizationId!, contactId) : restoreContact(organizationId!, contactId),
    onSuccess: (contact) => {
      qc.setQueryData(["socle-contact", organizationId, contactId], contact);
      qc.invalidateQueries({ queryKey: ["socle-contacts"] });
      toast.success(contact.status === "archived" ? "Contact archivé dans le référentiel" : "Contact restauré");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  });

  const contact = contactQuery.data ?? null;

  if (contactQuery.isError && isContactNotFound(contactQuery.error)) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("/contacts")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour aux contacts
        </Button>
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="font-medium">Contact introuvable dans le référentiel</p>
            <p className="text-sm text-muted-foreground">
              La fiche a peut-être été supprimée du référentiel. Les courriers qui la référencent
              restent consultables ; vous pouvez dissocier le contact depuis chaque courrier.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const TypeIcon = contact ? typeIcons[contact.contact_type] : User;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="ghost" onClick={() => navigate("/contacts")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Retour aux contacts
        </Button>
        {contact && (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4 mr-2" /> Modifier
            </Button>
            <Button
              variant="outline"
              onClick={() => archiveMutation.mutate(contact.status === "active")}
              disabled={archiveMutation.isPending}
            >
              {contact.status === "active" ? (
                <><Archive className="h-4 w-4 mr-2" /> Archiver</>
              ) : (
                <><ArchiveRestore className="h-4 w-4 mr-2" /> Restaurer</>
              )}
            </Button>
          </div>
        )}
      </div>

      {contactQuery.isLoading && <Card><CardContent className="py-10 text-center text-muted-foreground">Chargement…</CardContent></Card>}
      {contactQuery.isError && !isContactNotFound(contactQuery.error) && (
        <Card>
          <CardContent className="py-10 text-center text-destructive text-sm">
            {contactQuery.error instanceof Error ? contactQuery.error.message : "Erreur de chargement du contact"}
          </CardContent>
        </Card>
      )}

      {contact && (
        <>
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-3 flex-wrap">
                <TypeIcon className="h-6 w-6 text-muted-foreground" />
                <CardTitle className="text-xl">{contact.display_name || "—"}</CardTitle>
                <Badge variant="secondary">{SOCLE_CONTACT_TYPE_LABELS[contact.contact_type]}</Badge>
                {contact.status === "archived" && <Badge variant="destructive">Archivé</Badge>}
                <Badge variant="outline" className="ml-auto">Contact référentiel</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {contact.contact_type === "personne" ? (
                  <>
                    <InfoRow label="Civilité" value={contact.civility === "madame" ? "Madame" : contact.civility === "monsieur" ? "Monsieur" : null} />
                    <InfoRow label="Prénom" value={contact.first_name} />
                    <InfoRow label="Nom de naissance" value={contact.last_name} />
                    <InfoRow label="Nom d'usage" value={contact.usage_name} />
                    <InfoRow label="Date de naissance" value={contact.birth_date ? formatDate(contact.birth_date) : null} />
                  </>
                ) : (
                  <>
                    <InfoRow label="Raison sociale" value={contact.legal_name} />
                    <InfoRow label="SIRET" value={contact.siret} />
                  </>
                )}
                <InfoRow label="Email" value={contact.email} />
                <InfoRow label="Téléphone mobile" value={contact.mobile_phone} />
                <InfoRow label="Téléphone fixe" value={contact.landline_phone} />
                <InfoRow
                  label="Canal préféré"
                  value={contact.preferred_channel === "email" ? "Email" : contact.preferred_channel === "telephone" ? "Téléphone" : contact.preferred_channel === "courrier" ? "Courrier" : null}
                />
              </div>
              <Separator />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <InfoRow label="Adresse" value={[contact.address_line1, contact.address_line2].filter(Boolean).join(", ")} />
                <InfoRow label="Code postal" value={contact.postal_code} />
                <InfoRow label="Ville" value={contact.city} />
                <InfoRow label="Pays" value={contact.country} />
              </div>
              <Separator />
              <div className="flex items-center gap-6 text-sm flex-wrap">
                <span className={cn(contact.consent_email ? "" : "text-muted-foreground")}>
                  Accepte les mails : {contact.consent_email ? "oui" : "non"}
                </span>
                <span className={cn(contact.consent_sms ? "" : "text-muted-foreground")}>
                  Accepte les SMS : {contact.consent_sms ? "oui" : "non"}
                </span>
              </div>
              {contact.roles.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Rôles :</span>
                  {contact.roles.map((r) => <Badge key={r.id} variant="outline">{r.name}</Badge>)}
                </div>
              )}
              {contact.external_references.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs text-muted-foreground">Références externes</div>
                  {contact.external_references.map((ref) => (
                    <div key={ref.id} className="text-sm">
                      <span className="font-medium">{ref.source}</span> : {ref.external_id}
                    </div>
                  ))}
                </div>
              )}
              {contact.internal_notes && (
                <div className="rounded-md border bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground mb-1">Notes internes (agents uniquement)</div>
                  <div className="text-sm whitespace-pre-wrap">{contact.internal_notes}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <ContactRelationsCard
            organizationId={organizationId!}
            contact={contact}
            onUpdated={(saved) => {
              qc.setQueryData(["socle-contact", organizationId, contactId], saved);
              qc.invalidateQueries({ queryKey: ["socle-contacts"] });
            }}
          />

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Courriers liés</CardTitle>
            </CardHeader>
            <CardContent>
              {couriersQuery.isLoading && <p className="text-sm text-muted-foreground">Chargement…</p>}
              {couriersQuery.isError && (
                <p className="text-sm text-muted-foreground">Courriers liés indisponibles.</p>
              )}
              {couriersQuery.data && couriersQuery.data.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucun courrier lié à ce contact.</p>
              )}
              {couriersQuery.data && couriersQuery.data.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Chrono</TableHead>
                      <TableHead>Objet</TableHead>
                      <TableHead>Sens</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>État</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {couriersQuery.data.map((c: ContactCourier) => (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/courrier/${c.id}`)}
                      >
                        <TableCell className="font-mono text-xs">{c.chrono ?? "—"}</TableCell>
                        <TableCell className="max-w-[320px] truncate">{c.subject ?? "—"}</TableCell>
                        <TableCell>{c.direction === "inbound" ? "Entrant" : "Sortant"}</TableCell>
                        <TableCell>{formatDate(c.received_at ?? c.sent_at ?? c.created_at)}</TableCell>
                        <TableCell>{c.workflow_state?.name ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <ContactFormDialog
            organizationId={organizationId!}
            contact={contact}
            open={editOpen}
            onOpenChange={setEditOpen}
            onSaved={(saved) => {
              qc.setQueryData(["socle-contact", organizationId, contactId], saved);
              qc.invalidateQueries({ queryKey: ["socle-contacts"] });
            }}
          />
        </>
      )}
    </div>
  );
}

// ── Liste des contacts ──────────────────────────────────────────────────────

function ContactsList() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [typeFilter, setTypeFilter] = useState<SocleContactType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");
  const [page, setPage] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: typeFilter === "all" ? undefined : typeFilter,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    [debouncedSearch, typeFilter, statusFilter],
  );

  const contactsQuery = useQuery({
    queryKey: ["socle-contacts", organizationId, filters, page],
    queryFn: () =>
      listContacts(organizationId!, { ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  const contacts = contactsQuery.data ?? [];
  const hasNextPage = contacts.length === PAGE_SIZE;

  async function handleExportCsv() {
    if (!organizationId) return;
    setExporting(true);
    try {
      const rows = await fetchAllContactsForExport(organizationId, filters);
      const columns: CsvColumn<SocleContact>[] = [
        { header: "Type", accessor: (c) => SOCLE_CONTACT_TYPE_LABELS[c.contact_type] },
        { header: "Nom", accessor: (c) => c.display_name ?? "" },
        { header: "Email", accessor: (c) => c.email ?? "" },
        { header: "Téléphone mobile", accessor: (c) => c.mobile_phone ?? "" },
        { header: "Téléphone fixe", accessor: (c) => c.landline_phone ?? "" },
        { header: "Adresse", accessor: (c) => [c.address_line1, c.address_line2].filter(Boolean).join(", ") },
        { header: "Code postal", accessor: (c) => c.postal_code ?? "" },
        { header: "Ville", accessor: (c) => c.city ?? "" },
        { header: "SIRET", accessor: (c) => c.siret ?? "" },
        { header: "Statut", accessor: (c) => (c.status === "active" ? "Actif" : "Archivé") },
      ];
      downloadCsv(buildCsv(rows, columns), "contacts.csv");
      toast.success(`${rows.length} contact(s) exporté(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'export");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            Référentiel de contacts partagé avec les autres
            applications de la collectivité.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportCsv} disabled={exporting}>
            <Download className="h-4 w-4 mr-2" />
            {exporting ? "Export…" : "Exporter"}
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Nouveau contact
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher par nom…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v as SocleContactType | "all"); setPage(0); }}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous les types</SelectItem>
            {Object.entries(SOCLE_CONTACT_TYPE_LABELS).map(([type, label]) => (
              <SelectItem key={type} value={type}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as "active" | "archived" | "all"); setPage(0); }}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Actifs</SelectItem>
            <SelectItem value="archived">Archivés</SelectItem>
            <SelectItem value="all">Tous</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {contactsQuery.isError ? (
            <div className="py-10 text-center text-sm text-destructive">
              {contactsQuery.error instanceof Error ? contactsQuery.error.message : "Erreur de chargement des contacts"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Type</TableHead>
                  <TableHead>Nom</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Téléphone</TableHead>
                  <TableHead>Ville</TableHead>
                  {statusFilter !== "active" && <TableHead>Statut</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contactsQuery.isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Chargement…
                    </TableCell>
                  </TableRow>
                )}
                {!contactsQuery.isLoading && contacts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      Aucun contact.
                    </TableCell>
                  </TableRow>
                )}
                {contacts.map((c) => {
                  const TypeIcon = typeIcons[c.contact_type];
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/contacts/${c.id}`)}
                    >
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <TypeIcon className="h-4 w-4 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {SOCLE_CONTACT_TYPE_LABELS[c.contact_type]}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{c.display_name ?? "—"}</TableCell>
                      <TableCell>{c.email ?? "—"}</TableCell>
                      <TableCell>{contactPhone(c)}</TableCell>
                      <TableCell>{c.city ?? "—"}</TableCell>
                      {statusFilter !== "active" && (
                        <TableCell>
                          {c.status === "archived"
                            ? <Badge variant="destructive">Archivé</Badge>
                            : <Badge variant="secondary">Actif</Badge>}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Précédent
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1}</span>
        <Button variant="outline" size="sm" disabled={!hasNextPage} onClick={() => setPage((p) => p + 1)}>
          Suivant <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

      <ContactFormDialog
        organizationId={organizationId!}
        contact={null}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(saved) => {
          qc.invalidateQueries({ queryKey: ["socle-contacts"] });
          navigate(`/contacts/${saved.id}`);
        }}
      />
    </div>
  );
}

export default function Contacts() {
  const params = useParams<{ id?: string }>();
  return params.id ? <ContactDetail contactId={params.id} /> : <ContactsList />;
}
