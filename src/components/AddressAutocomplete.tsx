import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { searchBanAddress, type BanAddressSuggestion } from "@/services/banAddressService";

interface AddressAutocompleteProps {
  value: string;
  onChange: (text: string) => void;
  onSelect: (suggestion: BanAddressSuggestion) => void;
  placeholder?: string;
  id?: string;
  disabled?: boolean;
}

/**
 * Champ adresse une ligne avec autocomplete BAN (Géoplateforme IGN).
 * Agnostique de react-hook-form : utilisable aussi bien dans un FormField
 * (Usagers.tsx) que branché sur un state React classique (GeneralSettings.tsx).
 */
export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Rechercher une adresse…",
  id,
  disabled,
}: AddressAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const debouncedValue = useDebouncedValue(value, 350);

  const { data: suggestions = [], isFetching } = useQuery({
    queryKey: ["ban-address-search", debouncedValue],
    queryFn: ({ signal }) => searchBanAddress(debouncedValue, { signal }),
    enabled: debouncedValue.trim().length >= 3,
    staleTime: 60_000,
  });

  useEffect(() => {
    setOpen(debouncedValue.trim().length >= 3);
  }, [debouncedValue, suggestions.length]);

  return (
    <Popover open={open && suggestions.length > 0} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            id={id}
            value={value}
            disabled={disabled}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              if (value.trim().length >= 3) setOpen(true);
            }}
          />
          {isFetching && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="max-h-64 overflow-y-auto">
          {suggestions.map((s, i) => (
            <button
              key={`${s.label}-${i}`}
              type="button"
              className={cn(
                "flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => {
                onSelect(s);
                onChange(s.label);
                setOpen(false);
              }}
            >
              <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{s.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
