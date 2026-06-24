import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Sparkles, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  computeSimilarCouriers,
  createRelation,
  searchCouriersForLinking,
  type CourierRelationType,
  type RelatedCourierSummary,
} from "@/services/courierRelationService";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courierId: string;
  organizationId: string;
  /** Ids of couriers already linked to exclude from the picker. */
  excludeIds?: string[];
  onCreated?: () => void;
}

function CourierRow({
  courier,
  reasons,
  selected,
  onSelect,
}: {
  courier: RelatedCourierSummary;
  reasons?: string[];
  selected: boolean;
  onSelect: () => void;
}) {
  const sender = courier.courier_participants.find((p) => p.role === "sender");
  const date = courier.received_at ?? courier.sent_at;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-md border px-3 py-2 transition-colors hover:bg-muted/60 ${
        selected ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {courier.chrono && <span className="font-mono">{courier.chrono}</span>}
            {date && (
              <span>
                {new Date(date).toLocaleDateString("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                })}
              </span>
            )}
            {courier.assigned_service && <span>· {courier.assigned_service}</span>}
          </div>
          <div className="truncate text-sm font-medium">
            {courier.subject ?? <span className="italic text-muted-foreground">(sans objet)</span>}
          </div>
          {sender?.name && (
            <div className="truncate text-xs text-muted-foreground">De {sender.name}</div>
          )}
          {reasons && reasons.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {reasons.map((r) => (
                <Badge key={r} variant="secondary" className="text-[10px] font-normal">
                  {r}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

export default function LinkCourierDialog({
  open,
  onOpenChange,
  courierId,
  organizationId,
  excludeIds = [],
  onCreated,
}: Props) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"search" | "suggestions">("suggestions");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<RelatedCourierSummary | null>(null);
  const [relationType, setRelationType] = useState<CourierRelationType>("sujet_lie");
  const [relanceDirection, setRelanceDirection] = useState<"master" | "is_relance">(
    "is_relance",
  );
  const [note, setNote] = useState("");

  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ["link-search", organizationId, courierId, query],
    queryFn: () => searchCouriersForLinking(organizationId, query, courierId),
    enabled: open && mode === "search",
  });

  const { data: suggestions = [], isFetching: loadingSuggestions } = useQuery({
    queryKey: ["link-suggestions", organizationId, courierId, excludeIds.join(",")],
    queryFn: () => computeSimilarCouriers(organizationId, courierId, { excludeIds }),
    enabled: open && mode === "suggestions",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Sélectionnez un courrier");
      // For 'relance', orient the relation: target = master, source = relance.
      let source = courierId;
      let target = selected.id;
      if (relationType === "relance" && relanceDirection === "master") {
        // current courier is the master, the picked one is the relance
        source = selected.id;
        target = courierId;
      }
      return createRelation({
        organizationId,
        sourceCourierId: source,
        targetCourierId: target,
        relationType,
        note: note.trim() || null,
        createdVia: mode === "suggestions" ? "ai_suggestion" : "manual",
      });
    },
    onSuccess: () => {
      toast.success("Lien créé");
      queryClient.invalidateQueries({ queryKey: ["courier-relations", courierId] });
      onCreated?.();
      onOpenChange(false);
      // reset
      setSelected(null);
      setNote("");
      setQuery("");
    },
    onError: (e: Error) => {
      if (e.message.includes("duplicate")) toast.error("Ce lien existe déjà");
      else toast.error(e.message || "Erreur lors de la création du lien");
    },
  });

  const suggestionsById = useMemo(
    () => new Map(suggestions.map((s) => [s.courier.id, s.reasons])),
    [suggestions],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" /> Lier un courrier
          </DialogTitle>
          <DialogDescription>
            Reliez ce courrier à un autre, comme relance ou comme courrier traitant du même sujet.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => { setMode(v as "search" | "suggestions"); setSelected(null); }}>
          <TabsList>
            <TabsTrigger value="suggestions" className="gap-2">
              <Sparkles className="h-3.5 w-3.5" /> Suggestions
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-2">
              <Search className="h-3.5 w-3.5" /> Recherche
            </TabsTrigger>
          </TabsList>

          <TabsContent value="suggestions" className="space-y-2">
            {loadingSuggestions ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Analyse en cours…</p>
            ) : suggestions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Aucun courrier similaire détecté.
              </p>
            ) : (
              <ScrollArea className="h-64 pr-2">
                <div className="space-y-1.5">
                  {suggestions.map((s) => (
                    <CourierRow
                      key={s.courier.id}
                      courier={s.courier}
                      reasons={s.reasons}
                      selected={selected?.id === s.courier.id}
                      onSelect={() => setSelected(s.courier)}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="search" className="space-y-2">
            <Input
              autoFocus
              placeholder="Rechercher par objet ou référence (chrono)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <ScrollArea className="h-64 pr-2">
              {searching ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Recherche…</p>
              ) : searchResults.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Aucun résultat.</p>
              ) : (
                <div className="space-y-1.5">
                  {searchResults.map((c) => (
                    <CourierRow
                      key={c.id}
                      courier={c}
                      reasons={suggestionsById.get(c.id)}
                      selected={selected?.id === c.id}
                      onSelect={() => setSelected(c)}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {selected && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div className="space-y-2">
              <Label className="text-xs">Type de lien</Label>
              <RadioGroup
                value={relationType}
                onValueChange={(v) => setRelationType(v as CourierRelationType)}
                className="flex flex-col gap-1.5"
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="sujet_lie" id="rl-sujet" />
                  <Label htmlFor="rl-sujet" className="text-sm font-normal">
                    Sujet lié (les deux courriers parlent du même sujet)
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="relance" id="rl-relance" />
                  <Label htmlFor="rl-relance" className="text-sm font-normal">
                    Relance
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {relationType === "relance" && (
              <div className="space-y-2">
                <Label className="text-xs">Sens</Label>
                <RadioGroup
                  value={relanceDirection}
                  onValueChange={(v) => setRelanceDirection(v as "master" | "is_relance")}
                  className="flex flex-col gap-1.5"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="is_relance" id="rl-is-relance" />
                    <Label htmlFor="rl-is-relance" className="text-sm font-normal">
                      Ce courrier est une relance du courrier sélectionné
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="master" id="rl-master" />
                    <Label htmlFor="rl-master" className="text-sm font-normal">
                      Ce courrier est relancé par le courrier sélectionné
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="rl-note" className="text-xs">Note (optionnel)</Label>
              <Textarea
                id="rl-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Précisez pourquoi ce lien…"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!selected || mutation.isPending}
          >
            Créer le lien
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
