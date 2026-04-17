import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { listUsagers, createUsager, type Usager, type UsagerCategory } from "@/services/usagerService";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const categoryLabels: Record<UsagerCategory, string> = {
  citoyen: "Citoyen",
  entreprise: "Entreprise",
  association: "Association",
};

function display(u: Usager) {
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email || "—";
  return name;
}

interface Props {
  organizationId: string;
  value: Usager | null;
  onChange: (u: Usager | null) => void;
}

export default function UsagerPicker({ organizationId, value, onChange }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: usagers = [] } = useQuery({
    queryKey: ["usagers", organizationId, search],
    queryFn: () => listUsagers(organizationId, search),
    enabled: !!organizationId,
  });

  // Quick create form state
  const [c_cat, setCCat] = useState<UsagerCategory>("citoyen");
  const [c_civ, setCCiv] = useState<"madame" | "monsieur" | "">("");
  const [c_first, setCFirst] = useState("");
  const [c_last, setCLast] = useState("");
  const [c_email, setCEmail] = useState("");
  const [c_phone, setCPhone] = useState("");
  const [creating, setCreating] = useState(false);

  function resetCreate() {
    setCCat("citoyen");
    setCCiv("");
    setCFirst("");
    setCLast("");
    setCEmail("");
    setCPhone("");
  }

  async function handleCreate() {
    if (!c_last.trim()) {
      toast.error("Le nom est obligatoire");
      return;
    }
    if (c_cat === "citoyen" && (!c_civ || !c_first.trim())) {
      toast.error("Civilité et prénom obligatoires pour un citoyen");
      return;
    }
    setCreating(true);
    try {
      const u = await createUsager(organizationId, {
        category: c_cat,
        civilite: c_cat === "citoyen" ? (c_civ || null) : null,
        first_name: c_first || null,
        last_name: c_last,
        email: c_email || null,
        phone: c_phone || null,
      });
      qc.invalidateQueries({ queryKey: ["usagers"] });
      onChange(u);
      toast.success("Usager créé");
      setCreateOpen(false);
      resetCreate();
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
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
            className="w-full justify-between font-normal"
          >
            {value ? (
              <span className="flex items-center gap-2 truncate">
                <Badge variant="secondary" className="shrink-0">{categoryLabels[value.category]}</Badge>
                <span className="truncate">{display(value)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">Sélectionner un usager…</span>
            )}
            <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Rechercher par nom, email, téléphone…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>Aucun usager trouvé.</CommandEmpty>
              <CommandGroup>
                {value && (
                  <CommandItem
                    value="__clear"
                    onSelect={() => { onChange(null); setOpen(false); }}
                    className="text-muted-foreground italic"
                  >
                    Aucun usager
                  </CommandItem>
                )}
                {usagers.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={u.id}
                    onSelect={() => { onChange(u); setOpen(false); }}
                    className="flex items-center gap-2"
                  >
                    <Check className={cn("h-4 w-4", value?.id === u.id ? "opacity-100" : "opacity-0")} />
                    <Badge variant="secondary" className="shrink-0">{categoryLabels[u.category]}</Badge>
                    <span className="truncate">{display(u)}</span>
                    {u.email && <span className="ml-auto text-xs text-muted-foreground truncate">{u.email}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup>
                <CommandItem
                  value="__create"
                  onSelect={() => { setOpen(false); setCreateOpen(true); }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Créer un nouvel usager
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (!o) resetCreate(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nouvel usager</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nature *</Label>
              <Select value={c_cat} onValueChange={(v) => setCCat(v as UsagerCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="citoyen">Citoyen</SelectItem>
                  <SelectItem value="entreprise">Entreprise</SelectItem>
                  <SelectItem value="association">Association</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {c_cat === "citoyen" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Civilité *</Label>
                  <Select value={c_civ || undefined} onValueChange={(v) => setCCiv(v as any)}>
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
              <Label>{c_cat === "citoyen" ? "Nom *" : "Raison sociale *"}</Label>
              <Input value={c_last} onChange={(e) => setCLast(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={c_email} onChange={(e) => setCEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Téléphone</Label>
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
