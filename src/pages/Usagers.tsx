import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { ColumnDef, Table as TanstackTable } from "@tanstack/react-table";
import { ArrowLeft, Building2, Check, ChevronDown, Download, HeartHandshake, Plus, Search, Trash2, User, UserCircle2 } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DataTable } from "@/components/data-table/data-table";
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header";
import { DataTableColumnToggle } from "@/components/data-table/data-table-column-toggle";
import { DataTableGroupingSelect } from "@/components/data-table/data-table-grouping-select";
import { buildCsv, downloadCsv, type CsvColumn } from "@/components/data-table/csv-export";
import {
  getUsager,
  createUsager,
  updateUsager,
  deleteUsager,
  listUsagerCouriers,
  searchUsagers,
  fetchAllUsagersForExport,
  type Usager,
  type UsagerCategory,
  type UsagerFamilyStatus,
  type UsagerCourier,
  type UsagerWithInboundCount,
} from "@/services/usagerService";
import { listTags, type CourierTag } from "@/services/courierTagService";
import { readableTextColor } from "@/lib/tag-color";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import AddressMap from "@/components/AddressMap";
import { searchBanAddress, type BanAddressSuggestion } from "@/services/banAddressService";
import { listQuartiers, findQuartierForPoint, type Quartier } from "@/services/quartierService";

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

const familyStatusLabels: Record<UsagerFamilyStatus, string> = {
  celibataire: "Célibataire",
  marie: "Marié(e)",
  pacse: "Pacsé(e)",
  divorce: "Divorcé(e)",
  inconnu: "Inconnu",
};

/**
 * Indique si le mode "fichier domiciliaire" est activé pour l'organisation
 * (optionnable en configuration générale par un administrateur de la collectivité).
 */
function useDomiciliaryFileMode(organizationId: string | null) {
  const { data } = useQuery({
    queryKey: ["org-domiciliary-file-enabled", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations" as never)
        .select("domiciliary_file_enabled")
        .eq("id", organizationId!)
        .single();
      if (error) throw error;
      return data as unknown as { domiciliary_file_enabled: boolean };
    },
    enabled: !!organizationId,
  });
  return data?.domiciliary_file_enabled ?? false;
}

const schema = z
  .object({
    category: z.enum(["citoyen", "entreprise", "association"]),
    civilite: z.enum(["madame", "monsieur"]).optional().nullable(),
    first_name: z.string().trim().max(200).optional(),
    last_name: z.string().trim().min(1, "Nom obligatoire").max(200),
    email: z.string().trim().email("Email invalide").max(255).or(z.literal("")).optional(),
    phone: z.string().trim().max(50).optional(),
    // Quartier (général, indépendant du mode "fichier domiciliaire")
    quartier_id: z.string().optional().nullable(),
    quartier_auto: z.boolean().optional(),
    // Champs "fichier domiciliaire" — saisie optionnelle, affichés seulement si le mode est actif
    usual_name: z.string().trim().max(200).optional(),
    birth_date: z.string().trim().optional(),
    deceased: z.boolean().optional(),
    death_date: z.string().trim().optional(),
    family_status: z.enum(["celibataire", "marie", "pacse", "divorce", "inconnu"]).optional().nullable(),
    marriage_date: z.string().trim().optional(),
    pacs_date: z.string().trim().optional(),
    arrival_date: z.string().trim().optional(),
    departure_date: z.string().trim().optional(),
    nationality: z.string().trim().max(100).optional(),
    address_search: z.string().trim().max(300).optional(),
    address_number: z.string().trim().max(20).optional(),
    address_btq: z.string().trim().max(10).optional(),
    address_street: z.string().trim().max(200).optional(),
    address_building: z.string().trim().max(100).optional(),
    address_apartment: z.string().trim().max(100).optional(),
    address_complement: z.string().trim().max(200).optional(),
    address_postal_code: z.string().trim().max(20).optional(),
    address_city: z.string().trim().max(100).optional(),
    address_lat: z.number().optional().nullable(),
    address_lon: z.number().optional().nullable(),
    phone_2: z.string().trim().max(50).optional(),
  })
  .refine(
    (v) =>
      v.category !== "citoyen" || (v.civilite === "madame" || v.civilite === "monsieur"),
    { message: "Civilité obligatoire pour un citoyen", path: ["civilite"] },
  )
  .refine(
    (v) => v.category !== "citoyen" || (v.first_name && v.first_name.trim().length > 0),
    { message: "Prénom obligatoire pour un citoyen", path: ["first_name"] },
  );

type FormValues = z.infer<typeof schema>;

function fullName(u: Pick<Usager, "first_name" | "last_name">) {
  return [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || "—";
}

function UsagerFormDialog({
  open,
  onOpenChange,
  organizationId,
  editing,
  domiciliaryEnabled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  organizationId: string;
  editing: Usager | null;
  domiciliaryEnabled: boolean;
}) {
  const qc = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: {
      category: (editing?.category as UsagerCategory) ?? "citoyen",
      civilite: editing?.civilite ?? null,
      first_name: editing?.first_name ?? "",
      last_name: editing?.last_name ?? "",
      email: editing?.email ?? "",
      phone: editing?.phone ?? "",
      quartier_id: editing?.quartier_id ?? null,
      quartier_auto: editing?.quartier_auto ?? true,
      usual_name: editing?.usual_name ?? "",
      birth_date: editing?.birth_date ?? "",
      deceased: !!editing?.death_date,
      death_date: editing?.death_date ?? "",
      family_status: editing?.family_status ?? null,
      marriage_date: editing?.marriage_date ?? "",
      pacs_date: editing?.pacs_date ?? "",
      arrival_date: editing?.arrival_date ?? "",
      departure_date: editing?.departure_date ?? "",
      nationality: editing?.nationality ?? "",
      address_search: editing
        ? [editing.address_number, editing.address_btq, editing.address_street].filter(Boolean).join(" ")
        : "",
      address_number: editing?.address_number ?? "",
      address_btq: editing?.address_btq ?? "",
      address_street: editing?.address_street ?? "",
      address_building: editing?.address_building ?? "",
      address_apartment: editing?.address_apartment ?? "",
      address_complement: editing?.address_complement ?? "",
      address_postal_code: editing?.address_postal_code ?? "",
      address_city: editing?.address_city ?? "",
      address_lat: editing?.address_lat ?? null,
      address_lon: editing?.address_lon ?? null,
      phone_2: editing?.phone_2 ?? "",
    },
  });

  const category = form.watch("category");
  const deceased = form.watch("deceased");
  const familyStatus = form.watch("family_status");

  const { data: quartiers = [] } = useQuery({
    queryKey: ["quartiers", organizationId],
    queryFn: () => listQuartiers(organizationId),
    enabled: !!organizationId,
  });

  const [addressExpanded, setAddressExpanded] = useState(
    !!(editing?.address_number || editing?.address_street || editing?.address_postal_code),
  );
  useEffect(() => {
    setAddressExpanded(!!(editing?.address_number || editing?.address_street || editing?.address_postal_code));
  }, [editing]);

  const mut = useMutation({
    mutationFn: async (v: FormValues) => {
      const payload = {
        category: v.category,
        civilite: v.category === "citoyen" ? v.civilite ?? null : null,
        first_name: v.first_name || null,
        last_name: v.last_name || null,
        email: v.email || null,
        phone: v.phone || null,
        quartier_id: v.quartier_id || null,
        quartier_auto: v.quartier_auto ?? true,
        // Adresse : générale, indépendante du mode "fichier domiciliaire"
        // (nécessaire entre autres pour le rattachement à un quartier).
        address_number: v.address_number || null,
        address_btq: v.address_btq || null,
        address_street: v.address_street || null,
        address_building: v.address_building || null,
        address_apartment: v.address_apartment || null,
        address_complement: v.address_complement || null,
        address_postal_code: v.address_postal_code || null,
        address_city: v.address_city || null,
        address_lat: v.address_lat ?? null,
        address_lon: v.address_lon ?? null,
        ...(domiciliaryEnabled
          ? {
              usual_name: v.usual_name || null,
              birth_date: v.birth_date || null,
              death_date: v.deceased ? (v.death_date || null) : null,
              family_status: v.family_status ?? null,
              marriage_date: v.marriage_date || null,
              pacs_date: v.pacs_date || null,
              arrival_date: v.arrival_date || null,
              departure_date: v.departure_date || null,
              nationality: v.nationality || null,
              phone_2: v.phone_2 || null,
            }
          : {}),
      };
      if (editing) return updateUsager(editing.id, payload);
      return createUsager(organizationId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["usagers"] });
      qc.invalidateQueries({ queryKey: ["usager"] });
      toast.success(editing ? "Usager mis à jour" : "Usager créé");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Modifier l'usager" : "Nouvel usager"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nature *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="citoyen">Citoyen</SelectItem>
                      <SelectItem value="entreprise">Entreprise</SelectItem>
                      <SelectItem value="association">Association</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {category === "citoyen" && (
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="civilite"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Civilité *</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value ?? undefined}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="—" />
                          </SelectTrigger>
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
                      <FormLabel>Prénom *</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="last_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{category === "citoyen" ? "Nom *" : "Raison sociale *"}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input type="email" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Téléphone</FormLabel>
                    <FormControl>
                      <Input type="tel" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="quartier_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quartier</FormLabel>
                  <Select
                    onValueChange={(v) => {
                      field.onChange(v === "__none" ? null : v);
                      form.setValue("quartier_auto", false);
                    }}
                    value={field.value ?? "__none"}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none">Aucun</SelectItem>
                      {quartiers.map((q) => (
                        <SelectItem key={q.id} value={q.id}>{q.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center justify-between pt-2">
              <p className="text-sm font-medium text-muted-foreground">Adresse</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAddressExpanded((v) => !v)}
              >
                {addressExpanded ? "Masquer le détail" : "Compléter"}
              </Button>
            </div>

            <FormField
              control={form.control}
              name="address_search"
              render={({ field }) => (
                <FormItem>
                  <AddressAutocomplete
                    value={field.value ?? ""}
                    onChange={(text) => {
                      field.onChange(text);
                      // Ne jamais perdre la frappe libre si l'utilisateur ne
                      // sélectionne aucune suggestion (adresse hors BAN, étranger…).
                      form.setValue("address_street", text);
                    }}
                    onSelect={async (s: BanAddressSuggestion) => {
                      form.setValue("address_number", s.number ?? "");
                      form.setValue("address_btq", s.btq ?? "");
                      form.setValue("address_street", s.street ?? "");
                      form.setValue("address_postal_code", s.postcode ?? "");
                      form.setValue("address_city", s.city ?? "");
                      form.setValue("address_lat", s.lat);
                      form.setValue("address_lon", s.lon);
                      setAddressExpanded(true);
                      // Auto-assignation du quartier si l'utilisateur n'a pas déjà forcé une valeur manuelle.
                      if (form.getValues("quartier_auto") && s.lat != null && s.lon != null) {
                        try {
                          const quartierId = await findQuartierForPoint(organizationId, s.lon, s.lat);
                          form.setValue("quartier_id", quartierId);
                        } catch {
                          // Pas bloquant : l'utilisateur peut toujours choisir le quartier manuellement.
                        }
                      }
                    }}
                    placeholder="Rechercher une adresse…"
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            {addressExpanded && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    control={form.control}
                    name="address_number"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Numéro</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address_btq"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>BTQ</FormLabel>
                        <FormControl>
                          <Input placeholder="bis, ter…" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address_street"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Voie</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    control={form.control}
                    name="address_building"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bâtiment</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address_apartment"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Appartement</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address_complement"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Complément</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    control={form.control}
                    name="address_postal_code"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Code postal</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="address_city"
                    render={({ field }) => (
                      <FormItem className="col-span-2">
                        <FormLabel>Ville</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </>
            )}

            {domiciliaryEnabled && (
              <>
                <Separator />
                <p className="text-sm font-semibold text-muted-foreground">Fichier domiciliaire</p>

                <FormField
                  control={form.control}
                  name="usual_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nom usuel</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-3 items-end">
                  <FormField
                    control={form.control}
                    name="birth_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date de naissance</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="deceased"
                    render={({ field }) => (
                      <FormItem className="flex items-center justify-between rounded-lg border p-2.5">
                        <FormLabel className="!mt-0">Décédé</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value ?? false}
                            onCheckedChange={(val) => {
                              field.onChange(val);
                              if (!val) form.setValue("death_date", "");
                            }}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>

                {deceased && (
                  <FormField
                    control={form.control}
                    name="death_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date de décès</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="family_status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Situation familiale</FormLabel>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value ?? undefined}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {Object.entries(familyStatusLabels).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="nationality"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Nationalité</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {familyStatus === "marie" && (
                  <FormField
                    control={form.control}
                    name="marriage_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date de mariage</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {familyStatus === "pacse" && (
                  <FormField
                    control={form.control}
                    name="pacs_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date du Pacs</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="arrival_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date d'arrivée</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="departure_date"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Date de départ</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="phone_2"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Téléphone 2</FormLabel>
                      <FormControl>
                        <Input type="tel" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            <Button type="submit" className="w-full" disabled={mut.isPending}>
              {mut.isPending ? "Enregistrement…" : editing ? "Enregistrer" : "Créer"}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("fr-FR") : "—";
}

function formatAddress(u: Usager) {
  const line1 = [u.address_number, u.address_btq, u.address_street].filter(Boolean).join(" ");
  const line2 = [u.address_building, u.address_apartment].filter(Boolean).join(" ");
  const line3 = [u.address_postal_code, u.address_city].filter(Boolean).join(" ");
  const lines = [line1, line2, u.address_complement, line3].filter((l) => l && l.trim().length > 0);
  return lines.length ? lines : null;
}

function QuartierBadge({ quartier }: { quartier: Quartier | null | undefined }) {
  if (!quartier) return <span className="text-muted-foreground">—</span>;
  const fg = quartier.color ? readableTextColor(quartier.color) : undefined;
  return (
    <Badge
      variant="secondary"
      style={quartier.color ? { backgroundColor: quartier.color, color: fg } : undefined}
    >
      {quartier.name}
    </Badge>
  );
}

function QuartierMultiSelect({
  quartiers,
  selected,
  onChange,
}: {
  quartiers: Quartier[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  const label =
    selected.length === 0
      ? "Tous les quartiers"
      : selected.length === 1
        ? quartiers.find((q) => q.id === selected[0])?.name ?? "1 quartier"
        : `${selected.length} quartiers`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Même représentation visuelle que SelectTrigger (border-input/bg-background,
            pas de survol coloré, flèche à droite) pour rester cohérent avec les
            autres champs de type liste déroulante de l'app. */}
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-10 min-w-[180px] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Rechercher un quartier…" />
          <CommandList>
            <CommandEmpty>Aucun quartier</CommandEmpty>
            <CommandGroup>
              {quartiers.map((q) => {
                const checked = selected.includes(q.id);
                return (
                  <CommandItem key={q.id} value={q.name} onSelect={() => toggle(q.id)}>
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0 mr-2 ring-1 ring-border"
                      style={{ backgroundColor: q.color ?? "hsl(var(--muted-foreground))" }}
                    />
                    <span className="flex-1 truncate">{q.name}</span>
                    <Check className={cn("h-3.5 w-3.5", checked ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="border-t p-1">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => onChange([])}>
              Effacer la sélection
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Multi-sélection générique (ex. listes d'années) — même représentation que QuartierMultiSelect. */
function MultiSelectFilter({
  options,
  selected,
  onChange,
  placeholder,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);

  function toggle(value: string) {
    onChange(selected.includes(value) ? selected.filter((x) => x !== value) : [...selected, value]);
  }

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.value === selected[0])?.label ?? "1 sélection"
        : `${selected.length} sélections`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-10 min-w-[160px] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <span className={cn("truncate", selected.length === 0 && "text-muted-foreground")}>{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandList>
            <CommandGroup>
              {options.map((o) => {
                const checked = selected.includes(o.value);
                return (
                  <CommandItem key={o.value} value={o.label} onSelect={() => toggle(o.value)}>
                    <span className="flex-1">{o.label}</span>
                    <Check className={cn("h-3.5 w-3.5", checked ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {selected.length > 0 && (
          <div className="border-t p-1">
            <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => onChange([])}>
              Effacer la sélection
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const MARRIAGE_ANNIVERSARY_OPTIONS = [1, 10, 20, 30, 40, 60, 70, 80, 90].map((y) => ({
  value: String(y),
  label: `${y} an${y > 1 ? "s" : ""}`,
}));

const BIRTHDAY_ANNIVERSARY_OPTIONS = Array.from({ length: 12 }, (_, i) => (i + 1) * 10).map((y) => ({
  value: String(y),
  label: `${y} ans`,
}));

function UsagerAddressMapCard({ usager }: { usager: Usager }) {
  const hasStoredCoords = usager.address_lat != null && usager.address_lon != null;
  const addressLines = formatAddress(usager);
  const fullAddressQuery = [
    usager.address_number,
    usager.address_btq,
    usager.address_street,
    usager.address_postal_code,
    usager.address_city,
  ].filter(Boolean).join(" ");

  // Fallback pour les usagers domiciliaires créés avant cette fonctionnalité,
  // sans lat/lon stockées : géocodage à la volée, pas de réécriture en base.
  const { data: fallbackCoords, isFetching } = useQuery({
    queryKey: ["usager-address-geocode-fallback", usager.id, fullAddressQuery],
    queryFn: async () => {
      const results = await searchBanAddress(fullAddressQuery, { limit: 1 });
      return results[0] ?? null;
    },
    enabled: !hasStoredCoords && fullAddressQuery.trim().length >= 5,
    staleTime: Infinity,
  });

  const lat = hasStoredCoords ? usager.address_lat! : fallbackCoords?.lat;
  const lon = hasStoredCoords ? usager.address_lon! : fallbackCoords?.lon;

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <h2 className="text-sm font-semibold">Adresse</h2>
        {addressLines ? (
          <div className="text-sm text-muted-foreground">
            {addressLines.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Aucune adresse renseignée.</p>
        )}
        {lat != null && lon != null ? (
          <AddressMap lat={lat} lon={lon} label={addressLines?.join(" ")} />
        ) : isFetching ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Localisation en cours…</p>
        ) : addressLines ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Adresse non géolocalisable.</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function UsagerDetail({
  usagerId,
  organizationId,
  onBack,
  domiciliaryEnabled,
}: {
  usagerId: string;
  organizationId: string;
  onBack: () => void;
  domiciliaryEnabled: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: usager, isLoading } = useQuery({
    queryKey: ["usager", usagerId],
    queryFn: () => getUsager(usagerId),
    enabled: !!usagerId,
  });

  const { data: couriers = [] } = useQuery({
    queryKey: ["usager-couriers", usagerId],
    queryFn: () => listUsagerCouriers(usagerId),
    enabled: !!usagerId,
  });

  const { data: orgTags = [] } = useQuery({
    queryKey: ["courier-tags", organizationId],
    queryFn: () => listTags(organizationId),
    enabled: !!organizationId,
  });

  const tagByName = new Map<string, CourierTag>(
    orgTags.map((t) => [t.name.toLowerCase(), t]),
  );

  const { data: quartiers = [] } = useQuery({
    queryKey: ["quartiers", organizationId],
    queryFn: () => listQuartiers(organizationId),
    enabled: !!organizationId,
  });
  const quartierById = new Map(quartiers.map((q) => [q.id, q]));

  const delMut = useMutation({
    mutationFn: () => deleteUsager(usagerId),
    onSuccess: () => {
      toast.success("Usager supprimé");
      qc.invalidateQueries({ queryKey: ["usagers"] });
      onBack();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !usager) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">Chargement…</CardContent>
      </Card>
    );
  }

  const Icon = categoryIcons[usager.category];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Retour">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 flex-1">
          <Icon className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{fullName(usager)}</h1>
            <p className="text-muted-foreground text-sm flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">{categoryLabels[usager.category]}</Badge>
              <QuartierBadge quartier={usager.quartier_id ? quartierById.get(usager.quartier_id) : null} />
              <span>{usager.email ?? "—"} {usager.phone ? `· ${usager.phone}` : ""}</span>
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}>Modifier</Button>
        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setConfirmDelete(true)} aria-label="Supprimer">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-sm font-semibold mb-3">Courriers liés ({couriers.length})</h2>
          {!couriers.length ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Aucun courrier lié à cet usager.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Chrono</TableHead>
                  <TableHead>Sens</TableHead>
                  <TableHead>Objet</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {couriers.map((c: UsagerCourier) => {
                  const tags = (c.metadata?.tags as string[] | undefined) ?? [];
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/courrier/${c.id}`)}
                    >
                      <TableCell className="text-sm">
                        {(() => {
                          const d = c.received_at ?? c.sent_at ?? c.created_at;
                          return d ? new Date(d).toLocaleDateString("fr-FR") : "—";
                        })()}
                      </TableCell>
                      <TableCell className="text-sm">{c.chrono ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {c.direction === "inbound" ? "Entrant" : c.direction === "outbound" ? "Sortant" : "Interne"}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{c.subject ?? "(sans objet)"}</TableCell>
                      <TableCell className="text-sm">
                        {c.workflow_state ? (
                          <Badge variant="outline">{c.workflow_state.name}</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        {tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {tags.map((t) => {
                              const meta = tagByName.get(t.toLowerCase());
                              const fg = meta?.color ? readableTextColor(meta.color) : undefined;
                              return (
                                <Badge
                                  key={t}
                                  variant="secondary"
                                  className="text-xs"
                                  style={meta?.color ? { backgroundColor: meta.color, color: fg } : undefined}
                                >
                                  {t}
                                </Badge>
                              );
                            })}
                          </div>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {domiciliaryEnabled && (
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-sm font-semibold mb-3">Fichier domiciliaire</h2>
            <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Nom usuel</dt>
                <dd>{usager.usual_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date de naissance</dt>
                <dd>{formatDate(usager.birth_date)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date de décès</dt>
                <dd>{formatDate(usager.death_date)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Situation familiale</dt>
                <dd>{usager.family_status ? familyStatusLabels[usager.family_status] : "—"}</dd>
              </div>
              {usager.family_status === "marie" && (
                <div>
                  <dt className="text-muted-foreground">Date de mariage</dt>
                  <dd>{formatDate(usager.marriage_date)}</dd>
                </div>
              )}
              {usager.family_status === "pacse" && (
                <div>
                  <dt className="text-muted-foreground">Date du Pacs</dt>
                  <dd>{formatDate(usager.pacs_date)}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Nationalité</dt>
                <dd>{usager.nationality ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Téléphone 2</dt>
                <dd>{usager.phone_2 ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date d'arrivée</dt>
                <dd>{formatDate(usager.arrival_date)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date de départ</dt>
                <dd>{formatDate(usager.departure_date)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      )}

      <UsagerAddressMapCard usager={usager} />

      <UsagerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        organizationId={organizationId}
        editing={usager}
        domiciliaryEnabled={domiciliaryEnabled}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cet usager ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les courriers liés ne seront pas supprimés mais perdront le rattachement à cet usager.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => delMut.mutate()}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const TODAY_ISO = new Date().toISOString().slice(0, 10);

export default function Usagers() {
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedQuartiers, setSelectedQuartiers] = useState<string[]>([]);
  const [minInbound, setMinInbound] = useState("");
  const [sentFrom, setSentFrom] = useState("");
  const [sentTo, setSentTo] = useState(TODAY_ISO);
  const [selectedMarriageAnniv, setSelectedMarriageAnniv] = useState<string[]>([]);
  const [selectedBirthdayAges, setSelectedBirthdayAges] = useState<string[]>([]);
  const domiciliaryEnabled = useDomiciliaryFileMode(organizationId);

  const { data: usagers = [], isLoading } = useQuery({
    queryKey: [
      "usagers",
      organizationId,
      search,
      selectedQuartiers,
      minInbound,
      sentFrom,
      sentTo,
      selectedMarriageAnniv,
      selectedBirthdayAges,
    ],
    queryFn: () =>
      searchUsagers(organizationId!, {
        search,
        quartierIds: selectedQuartiers,
        minInbound: minInbound.trim() ? Number(minInbound) : null,
        // La période ne s'applique que si une date de début a été choisie —
        // la date de fin pré-remplie à aujourd'hui n'est qu'une valeur par défaut.
        sentFrom: sentFrom || null,
        sentTo: sentFrom ? sentTo || null : null,
        marriageAnniversaryYears: selectedMarriageAnniv.map(Number),
        birthdayYears: selectedBirthdayAges.map(Number),
      }),
    enabled: !!organizationId,
  });

  const hasActiveFilters =
    !!search ||
    selectedQuartiers.length > 0 ||
    !!minInbound ||
    !!sentFrom ||
    selectedMarriageAnniv.length > 0 ||
    selectedBirthdayAges.length > 0;
  function resetFilters() {
    setSearch("");
    setSelectedQuartiers([]);
    setMinInbound("");
    setSentFrom("");
    setSentTo(TODAY_ISO);
    setSelectedMarriageAnniv([]);
    setSelectedBirthdayAges([]);
  }

  const { data: quartiers = [] } = useQuery({
    queryKey: ["quartiers", organizationId],
    queryFn: () => listQuartiers(organizationId!),
    enabled: !!organizationId,
  });
  const quartierById = useMemo(() => new Map(quartiers.map((q) => [q.id, q])), [quartiers]);

  const [tableInstance, setTableInstance] = useState<TanstackTable<UsagerWithInboundCount> | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const columns = useMemo<ColumnDef<UsagerWithInboundCount>[]>(
    () => [
      {
        id: "icon",
        header: "",
        enableSorting: false,
        enableHiding: false,
        enableGrouping: false,
        cell: ({ row }) => {
          const Icon = categoryIcons[row.original.category];
          return <Icon className="h-4 w-4 text-muted-foreground" />;
        },
      },
      {
        id: "category",
        accessorFn: (u) => categoryLabels[u.category],
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nature" />,
        cell: ({ row }) => <Badge variant="secondary">{categoryLabels[row.original.category]}</Badge>,
        meta: { exportLabel: "Nature" },
      },
      {
        accessorKey: "last_name",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Nom" />,
        cell: ({ row }) => <span className="font-medium">{row.original.last_name ?? "—"}</span>,
        meta: { exportLabel: "Nom" },
      },
      {
        id: "first_name",
        accessorFn: (u) => (u.category === "citoyen" ? u.first_name ?? "" : ""),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Prénom" />,
        cell: ({ row }) => <>{row.original.category === "citoyen" ? row.original.first_name ?? "—" : "—"}</>,
        meta: { exportLabel: "Prénom" },
      },
      {
        id: "quartier",
        accessorFn: (u) => (u.quartier_id ? quartierById.get(u.quartier_id)?.name ?? "" : ""),
        header: ({ column }) => <DataTableColumnHeader column={column} title="Quartier" />,
        cell: ({ row }) => (
          <QuartierBadge quartier={row.original.quartier_id ? quartierById.get(row.original.quartier_id) : null} />
        ),
        meta: { exportLabel: "Quartier" },
      },
      {
        accessorKey: "inbound_count",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Courriers entrants" />,
        cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.inbound_count}</span>,
        meta: { exportLabel: "Courriers entrants" },
      },
      {
        accessorKey: "email",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
        cell: ({ row }) => <span className="text-sm">{row.original.email ?? "—"}</span>,
        meta: { exportLabel: "Email" },
      },
      {
        accessorKey: "phone",
        header: ({ column }) => <DataTableColumnHeader column={column} title="Téléphone" />,
        cell: ({ row }) => <span className="text-sm">{row.original.phone ?? "—"}</span>,
        meta: { exportLabel: "Téléphone" },
      },
    ],
    [quartierById],
  );

  async function handleExportCsv() {
    if (!organizationId || !tableInstance) return;
    setIsExporting(true);
    try {
      const allRows = await fetchAllUsagersForExport(organizationId, {
        search,
        quartierIds: selectedQuartiers,
        minInbound: minInbound.trim() ? Number(minInbound) : null,
        sentFrom: sentFrom || null,
        sentTo: sentFrom ? sentTo || null : null,
        marriageAnniversaryYears: selectedMarriageAnniv.map(Number),
        birthdayYears: selectedBirthdayAges.map(Number),
      });

      // Réapplique le tri courant (qui ne porte que sur les lignes affichées
      // à l'écran) sur l'intégralité des lignes exportées, via la même accessorFn.
      const sortState = tableInstance.getState().sorting[0];
      if (sortState) {
        const col = tableInstance.getColumn(sortState.id);
        const getValue = col?.accessorFn as ((row: UsagerWithInboundCount) => unknown) | undefined;
        if (getValue) {
          allRows.sort((a, b) => {
            const cmp = String(getValue(a) ?? "").localeCompare(String(getValue(b) ?? ""), "fr", { numeric: true });
            return sortState.desc ? -cmp : cmp;
          });
        }
      }

      const csvColumns: CsvColumn<UsagerWithInboundCount>[] = tableInstance
        .getVisibleLeafColumns()
        .filter((col) => col.id !== "icon")
        .map((col) => ({
          header: (col.columnDef.meta as { exportLabel?: string } | undefined)?.exportLabel ?? col.id,
          accessor: (row) => (col.accessorFn as ((row: UsagerWithInboundCount) => unknown) | undefined)?.(row) ?? "",
        }));

      const csv = buildCsv(allRows, csvColumns);
      downloadCsv(csv, `usagers-${TODAY_ISO}.csv`);
    } catch (e) {
      console.error(e);
      toast.error("Erreur lors de l'export du fichier.");
    } finally {
      setIsExporting(false);
    }
  }

  if (params.id && organizationId) {
    return (
      <UsagerDetail
        usagerId={params.id}
        organizationId={organizationId}
        onBack={() => navigate("/usagers")}
        domiciliaryEnabled={domiciliaryEnabled}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <UserCircle2 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Usagers</h1>
            <p className="text-muted-foreground">Personnes, entreprises et associations en relation avec votre organisation.</p>
          </div>
        </div>
        {organizationId && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Nouvel usager
          </Button>
        )}
      </div>

      {organizationId && (
        <div className="flex items-center justify-end gap-2">
          {tableInstance && <DataTableGroupingSelect table={tableInstance} />}
          {tableInstance && <DataTableColumnToggle table={tableInstance} />}
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={isExporting || !usagers.length}>
            <Download className="h-4 w-4 mr-1" />
            {isExporting ? "Export…" : "Exporter CSV"}
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="flex flex-col gap-1.5 flex-1 min-w-[200px]">
              <Label className="text-xs text-muted-foreground">Recherche</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Nom, prénom, email, téléphone…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Quartier</Label>
              <QuartierMultiSelect quartiers={quartiers} selected={selectedQuartiers} onChange={setSelectedQuartiers} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Courriers entrants min.</Label>
              <Input
                type="number"
                min={0}
                placeholder="Min"
                value={minInbound}
                onChange={(e) => setMinInbound(e.target.value)}
                className="w-20"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">A envoyé un courrier entre</Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="date"
                  value={sentFrom}
                  onChange={(e) => setSentFrom(e.target.value)}
                  max={sentTo || TODAY_ISO}
                  className="w-36"
                />
                <span className="text-muted-foreground text-sm">et</span>
                <Input
                  type="date"
                  value={sentTo}
                  onChange={(e) => setSentTo(e.target.value)}
                  min={sentFrom || undefined}
                  max={TODAY_ISO}
                  className="w-36"
                />
              </div>
            </div>

            {domiciliaryEnabled && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">
                    Grands anniversaires de mariage
                  </Label>
                  <MultiSelectFilter
                    options={MARRIAGE_ANNIVERSARY_OPTIONS}
                    selected={selectedMarriageAnniv}
                    onChange={setSelectedMarriageAnniv}
                    placeholder="Tous"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs text-muted-foreground whitespace-nowrap">Grands anniversaires</Label>
                  <MultiSelectFilter
                    options={BIRTHDAY_ANNIVERSARY_OPTIONS}
                    selected={selectedBirthdayAges}
                    onChange={setSelectedBirthdayAges}
                    placeholder="Tous"
                  />
                </div>
              </>
            )}

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Réinitialiser
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {!organizationId ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">Sélectionnez une organisation.</CardContent></Card>
      ) : (
        <DataTable
          columns={columns}
          data={usagers}
          isLoading={isLoading}
          onRowClick={(u) => navigate(`/usagers/${u.id}`)}
          onTableInstanceChange={setTableInstance}
          emptyMessage={hasActiveFilters ? "Aucun usager ne correspond à ces critères." : "Aucun usager pour le moment."}
        />
      )}

      {organizationId && (
        <UsagerFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
          editing={null}
          domiciliaryEnabled={domiciliaryEnabled}
        />
      )}
    </div>
  );
}
