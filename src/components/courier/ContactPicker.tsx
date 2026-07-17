import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  createContact,
  listContacts,
  SOCLE_CONTACT_TYPE_LABELS,
  type SocleContact,
  type SocleContactCivility,
  type SocleContactType,
} from "@/services/socleContactService";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import DuplicateContactsAlert from "@/components/contacts/DuplicateContactsAlert";

/** Nom affiché d'un contact Socle (display_name calculé côté Socle). */
export function contactDisplay(c: SocleContact): string {
  return c.display_name?.trim() || c.email || "—";
}

interface Props {
  organizationId: string;
  value: SocleContact | null;
  onChange: (c: SocleContact | null) => void;
  /** Restreint les types proposés — recherche ET création rapide (ex. cibles de relation). */
  types?: SocleContactType[];
  disabled?: boolean;
}

/**
 * Sélecteur de contact du référentiel Socle : recherche (nom d'affichage) +
 * création rapide via l'API du Socle. Les données affichées viennent du Socle,
 * jamais d'un stockage local.
 */
export default function ContactPicker({ organizationId, value, onChange, types, disabled }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);
  const [createOpen, setCreateOpen] = useState(false);

  const defaultType: SocleContactType = types?.[0] ?? "personne";
  const typeOptions = (Object.keys(SOCLE_CONTACT_TYPE_LABELS) as SocleContactType[]).filter(
    (t) => !types || types.includes(t),
  );

  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ["socle-contacts", organizationId, "picker", debouncedSearch, types?.join(",") ?? "all"],
    queryFn: async () => {
      const filters = {
        search: debouncedSearch || undefined,
        status: "active" as const,
        limit: 50,
        // L'API ne filtre que sur UN type : au-delà, on filtre côté client.
        ...(types?.length === 1 ? { type: types[0] } : {}),
      };
      const list = await listContacts(organizationId, filters);
      return types && types.length > 1 ? list.filter((c) => types.includes(c.contact_type)) : list;
    },
    enabled: !!organizationId && open,
    staleTime: 30_000,
  });

  // Création rapide
  const [c_type, setCType] = useState<SocleContactType>(defaultType);
  const [c_civ, setCCiv] = useState<SocleContactCivility | "">("");
  const [c_first, setCFirst] = useState("");
  const [c_last, setCLast] = useState("");
  const [c_email, setCEmail] = useState("");
  const [c_phone, setCPhone] = useState("");
  const [creating, setCreating] = useState(false);

  function resetCreate() {
    setCType(defaultType);
    setCCiv("");
    setCFirst("");
    setCLast("");
    setCEmail("");
    setCPhone("");
  }

  async function handleCreate() {
    if (c_type === "personne") {
      if (!c_civ || !c_first.trim() || !c_last.trim()) {
        toast.error("Civilité, prénom et nom obligatoires pour une personne");
        return;
      }
    } else if (!c_last.trim()) {
      toast.error("La raison sociale est obligatoire");
      return;
    }
    setCreating(true);
    try {
      const contact = await createContact(organizationId, {
        contact_type: c_type,
        civility: c_type === "personne" ? (c_civ || null) : null,
        first_name: c_type === "personne" ? c_first.trim() || null : null,
        last_name: c_type === "personne" ? c_last.trim() || null : null,
        legal_name: c_type !== "personne" ? c_last.trim() || null : null,
        email: c_email.trim() || null,
        mobile_phone: c_phone.trim() || null,
      });
      qc.invalidateQueries({ queryKey: ["socle-contacts"] });
      onChange(contact);
      toast.success("Contact créé dans le référentiel");
      setCreateOpen(false);
      resetCreate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur lors de la création du contact");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {value ? (
              <span className="flex items-center gap-2 truncate">
                <Badge variant="secondary" className="shrink-0">
                  {SOCLE_CONTACT_TYPE_LABELS[value.contact_type]}
                </Badge>
                <span className="truncate">{contactDisplay(value)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Sélectionner un contact…</span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Rechercher par nom…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>{isLoading ? "Recherche…" : "Aucun contact trouvé."}</CommandEmpty>
              <CommandGroup>
                {value && (
                  <CommandItem
                    value="__clear"
                    onSelect={() => { onChange(null); setOpen(false); }}
                    className="text-muted-foreground italic"
                  >
                    Aucun contact
                  </CommandItem>
                )}
                {contacts.map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => { onChange(c); setOpen(false); }}
                    className="flex items-center gap-2"
                  >
                    <Check className={cn("h-4 w-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                    <Badge variant="secondary" className="shrink-0">
                      {SOCLE_CONTACT_TYPE_LABELS[c.contact_type]}
                    </Badge>
                    <span className="truncate">{contactDisplay(c)}</span>
                    {c.email && <span className="ml-auto text-xs text-muted-foreground truncate">{c.email}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup>
                <CommandItem
                  value="__create"
                  onSelect={() => { setOpen(false); setCreateOpen(true); }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Créer un nouveau contact
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreate(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nouveau contact (référentiel)</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <DuplicateContactsAlert
              organizationId={organizationId}
              draft={{
                contact_type: c_type,
                first_name: c_type === "personne" ? c_first : null,
                last_name: c_type === "personne" ? c_last : null,
                legal_name: c_type !== "personne" ? c_last : null,
                email: c_email,
                mobile_phone: c_phone,
              }}
              onSelect={(contact) => {
                onChange(contact);
                setCreateOpen(false);
                resetCreate();
                toast.success("Contact existant sélectionné");
              }}
            />
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={c_type} onValueChange={(v) => setCType(v as SocleContactType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {typeOptions.map((type) => (
                    <SelectItem key={type} value={type}>{SOCLE_CONTACT_TYPE_LABELS[type]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {c_type === "personne" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Civilité *</Label>
                  <Select value={c_civ || undefined} onValueChange={(v) => setCCiv(v as SocleContactCivility)}>
                    <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="madame">Madame</SelectItem>
                      <SelectItem value="monsieur">Monsieur</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Prénom *</Label>
                  <Input value={c_first} onChange={(e) => setCFirst(e.target.value)} />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>{c_type === "personne" ? "Nom *" : "Raison sociale *"}</Label>
              <Input value={c_last} onChange={(e) => setCLast(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={c_email} onChange={(e) => setCEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Téléphone mobile</Label>
                <Input type="tel" value={c_phone} onChange={(e) => setCPhone(e.target.value)} />
              </div>
            </div>
            <Button className="w-full" onClick={handleCreate} disabled={creating}>
              {creating ? "Création…" : "Créer et sélectionner"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
