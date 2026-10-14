import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { splitAppliedTags } from "@/lib/courier-tags";
import { TAG_GROUPS, type CourierTag, type TagGroup } from "@/services/courierTagService";

interface Props {
  selected: string[];
  orgTags: CourierTag[];
  onToggle: (name: string) => void;
}

/**
 * Un bloc par groupe : le thème dit de quoi parle le courrier, le sentiment
 * sur quel ton. Mélangés dans une même rangée, les tags proposés par
 * l'analyse ne se lisaient plus.
 */
export function TagGroupPicker({ selected, orgTags, onToggle }: Props) {
  const [openGroup, setOpenGroup] = useState<TagGroup | null>(null);
  const tagsByGroup = useMemo(() => splitAppliedTags(selected, orgTags), [selected, orgTags]);

  return (
    <div className="space-y-2">
      <Label>Tags</Label>
      {TAG_GROUPS.map((group) => {
        const applied = tagsByGroup[group.value];
        const available = orgTags.filter((t) => t.tag_group === group.value);
        return (
          <div key={group.value} className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{group.label}</p>
            <div className="flex flex-wrap items-center gap-1.5 min-h-[28px]">
              {applied.map(({ name, tag }) => {
                const fg = tag?.color ? readableTextColor(tag.color) : undefined;
                return (
                  <Badge
                    key={name}
                    variant="secondary"
                    className={cn("gap-1.5 pl-2 pr-1 border-transparent", !tag && "italic opacity-60")}
                    style={tag?.color ? { backgroundColor: tag.color, color: fg } : undefined}
                  >
                    {name}
                    <button
                      type="button"
                      onClick={() => onToggle(name)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-black/20 transition-colors"
                      aria-label={`Retirer ${name}`}
                      style={fg ? { color: fg } : undefined}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
              <Popover open={openGroup === group.value} onOpenChange={(o) => setOpenGroup(o ? group.value : null)}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-dashed px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    aria-label={`Ajouter un tag — ${group.label}`}
                  >
                    <Plus className="h-3 w-3" />
                    Ajouter
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-0" align="start">
                  <Command>
                    <CommandInput placeholder={`Rechercher — ${group.label.toLowerCase()}…`} />
                    <CommandList>
                      <CommandEmpty>Aucun tag dans ce groupe. Allez dans Paramètres → Classification.</CommandEmpty>
                      <CommandGroup>
                        {available.map((tag) => {
                          const checked = selected.some((t) => t.toLowerCase() === tag.name.toLowerCase());
                          return (
                            <CommandItem key={tag.id} value={tag.name} onSelect={() => onToggle(tag.name)} className="gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: tag.color ?? "hsl(var(--muted-foreground))" }}
                              />
                              <span className="flex-1">{tag.name}</span>
                              <Check className={cn("h-4 w-4", checked ? "opacity-100" : "opacity-0")} />
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        );
      })}
    </div>
  );
}
