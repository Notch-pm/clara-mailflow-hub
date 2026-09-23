import { useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
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
  Copy,
  ExternalLink,
  HeartHandshake,
  Landmark,
  Pencil,
  Plus,
  Trash2,
  User,
  Users,
} from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import DuplicateContactsAlert from "@/components/contacts/DuplicateContactsAlert";
import { QuartierBadge } from "@/components/contacts/QuartierBadge";
import ConsentementsCard from "@/components/contacts/ConsentementsCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { buildCsv, downloadCsv, type CsvColumn } from "@/components/data-table/csv-export";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnToggle } from "@/components/data-table/data-table-column-toggle";
import { useDataTableInstance } from "@/components/data-table/use-data-table-instance";
import { ListCellText, ListCellTitle, StatusDot } from "@/components/list/ListCells";
import {
  FilterChips,
  FilterSection,
  ListActiveFilters,
  ListFilterButton,
  type ActiveFilterChip,
} from "@/components/list/ListFilters";
import {
  ListDensityToggle,
  ListExportButton,
  ListFooter,
  ListMessage,
  ListPage,
  ListSearch,
  ListToolbar,
  ToolbarButton,
  ToolbarTooltip,
} from "@/components/list/ListPage";
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
    internal_notes: values.internal_notes?.trim() || null,
  };
}

interface ContactFormDialogProps {
  organizationId: string;
  contact: SocleContact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (contact: SocleContact) => void;
  /** Reprendre un doublon détecté à la création plutôt que de créer la fiche. */
  onSelectExisting?: (contact: SocleContact) => void;
}

function ContactFormDialog({ organizationId, contact, open, onOpenChange, onSaved, onSelectExisting }: ContactFormDialogProps) {
  const isEdit = contact !== null;
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: contactToFormValues(contact),
  });
  const values = form.watch();
  const contactType = values.contact_type;
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
            {!isEdit && onSelectExisting && (
              <DuplicateContactsAlert
                organizationId={organizationId}
                draft={{
                  contact_type: values.contact_type,
                  first_name: values.first_name,
                  last_name: values.last_name,
                  usage_name: values.usage_name,
                  legal_name: values.legal_name,
                  siret: values.siret,
                  birth_date: values.birth_date,
                  email: values.email,
                  mobile_phone: values.mobile_phone,
                  landline_phone: values.landline_phone,
                }}
                onSelect={onSelectExisting}
                selectLabel="Ouvrir la fiche"
              />
            )}

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
              {/* L'id Socle est le numéro commun à la gamme : c'est lui qu'Iris affiche
                  pour l'usager (socle_contact_id des demandes). */}
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>N° référentiel :</span>
                <code className="font-mono text-foreground select-all">{contact.id}</code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label="Copier le numéro référentiel"
                  onClick={() => {
                    void navigator.clipboard.writeText(contact.id);
                    toast.success("Numéro référentiel copié dans le presse-papier");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
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
                <div>
                  <div className="text-xs text-muted-foreground">Quartier</div>
                  <div className="text-sm mt-0.5"><QuartierBadge quartier={contact.quartier} /></div>
                </div>
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

          <ConsentementsCard organizationId={organizationId!} contact={contact} />

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
  const [tableInstance, onTableInstanceChange] = useDataTableInstance<SocleContact>();

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      type: typeFilter === "all" ? undefined : typeFilter,
      status: statusFilter === "all" ? undefined : statusFilter,
    }),
    [debouncedSearch, typeFilter, statusFilter],
  );

  // On demande PAGE_SIZE + 1 pour savoir s'il existe une page suivante, sans
  // afficher la ligne excédentaire. Comparer `length === PAGE_SIZE` laissait
  // « Suivant » actif quand la dernière page était exactement pleine, menant à
  // une page vide. L'API du Socle ne renvoie pas de total, d'où cette astuce.
  const contactsQuery = useQuery({
    queryKey: ["socle-contacts", organizationId, filters, page],
    queryFn: () =>
      listContacts(organizationId!, { ...filters, limit: PAGE_SIZE + 1, offset: page * PAGE_SIZE }),
    enabled: !!organizationId,
    staleTime: 30_000,
  });

  const fetched = contactsQuery.data;
  const hasNextPage = (fetched?.length ?? 0) > PAGE_SIZE;
  // Stable d'un rendu à l'autre : le tableau ne recalcule ses lignes qu'à l'arrivée d'une page.
  const contacts = useMemo(() => (fetched ?? []).slice(0, PAGE_SIZE), [fetched]);

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
        { header: "Quartier", accessor: (c) => c.quartier?.name ?? "" },
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

  const columns = useMemo<ColumnDef<SocleContact>[]>(() => {
    const cols: ColumnDef<SocleContact>[] = [
      {
        id: "type",
        accessorFn: (c) => SOCLE_CONTACT_TYPE_LABELS[c.contact_type],
        header: "Type",
        cell: ({ row }) => {
          const TypeIcon = typeIcons[row.original.contact_type];
          return (
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <TypeIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="truncate">{SOCLE_CONTACT_TYPE_LABELS[row.original.contact_type]}</span>
            </span>
          );
        },
        meta: { label: "Type", width: 160 },
      },
      {
        id: "name",
        accessorFn: (c) => c.display_name ?? "",
        header: "Nom",
        cell: ({ row }) => <ListCellTitle title={row.original.display_name ?? "—"} />,
        enableHiding: false,
        meta: { label: "Nom", minWidth: 220 },
      },
      {
        id: "email",
        accessorFn: (c) => c.email ?? "",
        header: "Email",
        cell: ({ row }) => <ListCellText>{row.original.email ?? "—"}</ListCellText>,
        meta: { label: "Email", width: 260 },
      },
      {
        id: "phone",
        accessorFn: (c) => contactPhone(c),
        header: "Téléphone",
        cell: ({ row }) => <ListCellText className="tabular-nums">{contactPhone(row.original)}</ListCellText>,
        meta: { label: "Téléphone", width: 150 },
      },
      {
        id: "city",
        accessorFn: (c) => c.city ?? "",
        header: "Ville",
        cell: ({ row }) => <ListCellText>{row.original.city ?? "—"}</ListCellText>,
        meta: { label: "Ville", width: 170 },
      },
    ];
    // Le statut ne dit rien quand seuls les actifs sont affichés.
    if (statusFilter !== "active") {
      cols.push({
        id: "status",
        accessorFn: (c) => (c.status === "archived" ? "Archivé" : "Actif"),
        header: "Statut",
        cell: ({ row }) => (
          <StatusDot
            label={row.original.status === "archived" ? "Archivé" : "Actif"}
            tone={row.original.status === "archived" ? "muted" : "primary"}
          />
        ),
        meta: { label: "Statut", width: 110 },
      });
    }
    return cols;
  }, [statusFilter]);

  // Réinitialiser, c'est revenir à l'affichage par défaut : les contacts actifs.
  function resetFilters() {
    setTypeFilter("all");
    setStatusFilter("active");
    setPage(0);
  }

  const chips: ActiveFilterChip[] = [
    ...(typeFilter !== "all"
      ? [{ key: "type", label: `Type : ${SOCLE_CONTACT_TYPE_LABELS[typeFilter]}`, onRemove: () => { setTypeFilter("all"); setPage(0); } }]
      : []),
    ...(statusFilter !== "active"
      ? [{
          key: "status",
          label: statusFilter === "archived" ? "Statut : archivés" : "Archivés inclus",
          onRemove: () => { setStatusFilter("active"); setPage(0); },
        }]
      : []),
  ];

  const firstShown = page * PAGE_SIZE + 1;

  return (
    <ListPage>
      <ListToolbar
        icon={<Users className="text-primary" />}
        title="Contacts"
        search={
          <ListSearch
            value={search}
            onChange={(v) => { setSearch(v); setPage(0); }}
            placeholder="Rechercher par nom…"
          />
        }
        primary={
          <ToolbarTooltip label="Nouveau contact" hideFromXl>
            <ToolbarButton
              primary
              icon={<Plus />}
              label="Nouveau contact"
              text="Nouveau"
              showLabel
              onClick={() => setCreateOpen(true)}
            />
          </ToolbarTooltip>
        }
      >
        <ListFilterButton title="Filtrer les contacts" activeCount={chips.length} onReset={resetFilters}>
          <FilterSection label="Type">
            <FilterChips
              options={Object.entries(SOCLE_CONTACT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
              selected={typeFilter === "all" ? [] : [typeFilter]}
              onToggle={(v) => {
                setTypeFilter((cur) => (cur === v ? "all" : (v as SocleContactType)));
                setPage(0);
              }}
            />
          </FilterSection>
          <FilterSection label="Statut">
            <FilterChips
              options={[
                { value: "active", label: "Actifs" },
                { value: "archived", label: "Archivés" },
                { value: "all", label: "Tous" },
              ]}
              selected={[statusFilter]}
              onToggle={(v) => {
                setStatusFilter(v as "active" | "archived" | "all");
                setPage(0);
              }}
            />
          </FilterSection>
        </ListFilterButton>
        <ListDensityToggle />
        {tableInstance && <DataTableColumnToggle table={tableInstance} />}
        <ListExportButton onClick={handleExportCsv} busy={exporting} />
      </ListToolbar>
      <ListActiveFilters chips={chips} onReset={resetFilters} />

      {contactsQuery.isError ? (
        <ListMessage className="text-destructive">
          {contactsQuery.error instanceof Error ? contactsQuery.error.message : "Erreur de chargement des contacts"}
        </ListMessage>
      ) : (
        <DataTable
          columns={columns}
          data={contacts}
          getRowId={(c) => c.id}
          isLoading={contactsQuery.isLoading}
          onRowClick={(c) => navigate(`/contacts/${c.id}`)}
          onTableInstanceChange={onTableInstanceChange}
          emptyMessage="Aucun contact."
          itemLabel="contact"
          // L'API du Socle ne trie pas : un tri local ne porterait que sur la page.
          sortable={false}
          resetScrollKey={page}
          footer={
            // L'API du Socle ne renvoie pas de total : on pagine « à l'aveugle »,
            // précédent / suivant, sans numéros de page.
            <ListFooter>
              <p aria-live="polite">
                {contactsQuery.isFetching
                  ? "Chargement…"
                  : contacts.length
                    ? `Contacts ${firstShown.toLocaleString("fr-FR")}–${(firstShown + contacts.length - 1).toLocaleString("fr-FR")} · page ${page + 1}`
                    : `Page ${page + 1}`}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 rounded-md px-2 text-xs shadow-none"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Précédent
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 rounded-md px-2 text-xs shadow-none"
                  disabled={!hasNextPage}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Suivant <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </ListFooter>
          }
        />
      )}

      <ContactFormDialog
        organizationId={organizationId!}
        contact={null}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(saved) => {
          qc.invalidateQueries({ queryKey: ["socle-contacts"] });
          navigate(`/contacts/${saved.id}`);
        }}
        onSelectExisting={(existing) => {
          setCreateOpen(false);
          navigate(`/contacts/${existing.id}`);
        }}
      />
    </ListPage>
  );
}

export default function Contacts() {
  const params = useParams<{ id?: string }>();
  return params.id ? <ContactDetail contactId={params.id} /> : <ContactsList />;
}
