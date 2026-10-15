import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import DuplicateContactsAlert from "@/components/contacts/DuplicateContactsAlert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { roleCategory } from "@/lib/contact-categories";
import {
  contactFormSchema,
  contactToFormValues,
  formValuesToPayload,
  type ContactFormValues,
} from "@/lib/contact-form";
import { useContactRoleSelection } from "@/hooks/useContactRoles";
import {
  createContact,
  SOCLE_CONTACT_TYPE_LABELS,
  updateContact,
  type SocleContact,
} from "@/services/socleContactService";

interface ContactFormDialogProps {
  organizationId: string;
  contact: SocleContact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (contact: SocleContact) => void;
  /** Reprendre un doublon détecté à la création plutôt que de créer la fiche. */
  onSelectExisting?: (contact: SocleContact) => void;
}

/** Création / édition d'une fiche du référentiel Socle. */
export default function ContactFormDialog({
  organizationId,
  contact,
  open,
  onOpenChange,
  onSaved,
  onSelectExisting,
}: ContactFormDialogProps) {
  const isEdit = contact !== null;
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    values: contactToFormValues(contact),
  });
  const values = form.watch();
  const isPerson = values.contact_type === "personne";
  const roles = useContactRoleSelection(organizationId, contact, open);

  const mutation = useMutation({
    mutationFn: async (values: ContactFormValues) => {
      const payload = formValuesToPayload(values);
      const roleIds = roles.roleIdsToSend();
      if (roleIds) payload.role_ids = roleIds;
      if (isEdit) {
        // contact_type est immuable côté Socle : on ne l'envoie pas en PATCH.
        const { contact_type: _omit, ...patch } = payload;
        return updateContact(organizationId, contact.id, patch);
      }
      return createContact(organizationId, payload);
    },
    onSuccess: (saved) => {
      toast.success(isEdit ? "Contact mis à jour dans le référentiel" : "Contact créé dans le référentiel");
      roles.reset();
      onOpenChange(false);
      onSaved(saved);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Erreur lors de l'enregistrement du contact");
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) roles.reset(); onOpenChange(o); }}>
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

            <div className="space-y-2">
              <div className="text-sm font-medium">Rôles</div>
              <p className="text-xs text-muted-foreground">
                « Interne » (agents et services de la collectivité) et « Élu » font du contact un
                destinataire possible des courriers reçus et des tâches, et un expéditeur des courriers sortants.
              </p>
              {roles.rolesQuery.isLoading && <p className="text-xs text-muted-foreground">Chargement des rôles…</p>}
              {roles.rolesQuery.isError && (
                <p className="text-xs text-destructive">Rôles indisponibles : ils ne seront pas modifiés.</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {roles.roleOptions.map((role) => {
                  const id = `role-${role.id}`;
                  return (
                    <label key={role.id} htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        id={id}
                        checked={roles.currentRoleIds.includes(role.id)}
                        onCheckedChange={(v) => roles.toggleRole(role.id, v === true)}
                      />
                      <span className={cn(roleCategory(role) && "font-medium")}>{role.name}</span>
                    </label>
                  );
                })}
              </div>
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
