import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string;
  type?: "text" | "email" | "date";
  placeholder?: string;
  emptyDisplay?: string;
  maxLength?: number;
  onSave: (next: string) => Promise<void> | void;
  /** Render mode for the displayed value (read-only). */
  renderDisplay?: (value: string) => React.ReactNode;
  /** Extra classes applied to the displayed value (read mode). */
  displayClassName?: string;
}

export default function InlineEditField({
  label,
  value,
  type = "text",
  placeholder,
  emptyDisplay = "—",
  maxLength,
  onSave,
  renderDisplay,
  displayClassName,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Locally retained value: shown immediately after a successful save,
  // until the parent prop catches up.
  const [displayValue, setDisplayValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
    setDisplayValue(value);
  }, [value]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    if (draft === displayValue) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft);
      setDisplayValue(draft);
      setEditing(false);
    } catch {
      setDraft(displayValue);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setDraft(displayValue);
    setEditing(false);
  }

  return (
    <div className="flex items-start justify-between gap-2 group">
      <span className="text-muted-foreground text-sm shrink-0 pt-1">{label}</span>
      <div className="flex-1 gap-1 min-w-0 flex items-center justify-start">
        {editing ? (
          <>
            <Input
              ref={inputRef}
              type={type}
              value={draft}
              maxLength={maxLength}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancel();
                }
              }}
              placeholder={placeholder}
              disabled={saving}
              className="h-7 text-sm"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={commit}
              disabled={saving}
              aria-label="Enregistrer"
            >
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              onClick={cancel}
              disabled={saving}
              aria-label="Annuler"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              "flex items-center gap-1.5 text-sm font-medium text-right rounded px-1.5 py-0.5 -mx-1.5",
              "hover:bg-muted transition-colors max-w-full",
              displayClassName,
            )}
            title="Cliquer pour modifier"
          >
            <span className="truncate text-left">
              {value ? (renderDisplay ? renderDisplay(value) : value) : (
                <span className="text-muted-foreground italic font-normal">{emptyDisplay}</span>
              )}
            </span>
            <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          </button>
        )}
      </div>
    </div>
  );
}
