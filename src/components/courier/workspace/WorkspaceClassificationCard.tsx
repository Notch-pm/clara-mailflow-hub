import { useState } from "react";
import { Check, Tag as TagIcon, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TAG_GROUPS, type CourierTag, type TagGroup } from "@/services/courierTagService";
import type { AppliedTag } from "@/lib/courier-tags";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/tag-color";
import { RailCard } from "./RailParts";

interface Props {
  /** Tags posés sur le courrier, par groupe ; `tag` est nul si le tag a quitté le référentiel. */
  appliedByGroup: Record<TagGroup, AppliedTag[]>;
  orgTags: CourierTag[] | undefined;
  selectedTags: string[];
  readOnly: boolean;
  onToggle: (name: string) => void;
  onRemove: (name: string) => void;
}

/** Carte « Classement » : tags du courrier par groupe, avec choix dans le référentiel. */
export function WorkspaceClassificationCard({
  appliedByGroup,
  orgTags,
  selectedTags,
  readOnly,
  onToggle,
  onRemove,
}: Props) {
  const [popoverGroup, setPopoverGroup] = useState<TagGroup | null>(null);
  return (
    <RailCard title="Classement">
      <div className="space-y-3">
        {TAG_GROUPS.map((group) => {
          const applied = appliedByGroup[group.value];
          const available = (orgTags ?? []).filter((t) => t.tag_group === group.value);
          return (
            <div key={group.value} className="space-y-1.5">
              <span className="text-xs font-semibold text-muted-foreground">{group.label}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {applied.length === 0 && <span className="text-xs italic text-muted-foreground">Aucun</span>}
                {applied.map(({ name: tagName, tag }) => {
                  // Orphelin : appliqué sur le courrier, retiré du référentiel depuis.
                  const orphan = !tag;
                  const fg = tag?.color ? readableTextColor(tag.color) : undefined;
                  return (
                    <Badge
                      key={tagName}
                      variant="secondary"
                      className={cn(
                        "gap-1 border-transparent pl-2 pr-1 text-xs",
                        orphan && "italic opacity-60",
                        readOnly && "pr-2",
                      )}
                      style={tag?.color ? { backgroundColor: tag.color, color: fg } : undefined}
                    >
                      {tagName}
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onRemove(tagName);
                          }}
                          className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-black/20"
                          aria-label={`Retirer ${tagName}`}
                          style={fg ? { color: fg } : undefined}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  );
                })}
                {!readOnly && (
                  <Popover
                    open={popoverGroup === group.value}
                    onOpenChange={(o) => setPopoverGroup(o ? group.value : null)}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        aria-label={`Gérer les tags — ${group.label}`}
                      >
                        <TagIcon className="h-3.5 w-3.5" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="start">
                      <Command>
                        <CommandInput placeholder={`Rechercher — ${group.label.toLowerCase()}…`} />
                        <CommandList>
                          <CommandEmpty>Aucun tag dans ce groupe. Allez dans Paramètres → Classification.</CommandEmpty>
                          <CommandGroup>
                            {available.map((tag) => {
                              const checked = selectedTags.some((t) => t.toLowerCase() === tag.name.toLowerCase());
                              return (
                                <CommandItem
                                  key={tag.id}
                                  value={tag.name}
                                  onSelect={() => onToggle(tag.name)}
                                  className="gap-2"
                                >
                                  <span
                                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                                    style={{ backgroundColor: tag.color ?? "hsl(var(--muted-foreground))" }}
                                  />
                                  <span className="flex-1">{tag.name}</span>
                                  {checked && <Check className="h-4 w-4" />}
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </RailCard>
  );
}
