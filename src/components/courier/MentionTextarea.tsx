import { useEffect, useMemo, useRef, useState, forwardRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface MentionUser {
  id: string;
  label: string; // "Prénom Nom" ou email
  email?: string;
}

interface Props {
  value: string;
  onChange: (value: string, mentionedIds: string[]) => void;
  users: MentionUser[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  initialMentionIds?: string[];
}

/**
 * Reconstruit la liste d'IDs mentionnés en cherchant chaque @label connu dans le texte.
 */
function extractMentionIds(text: string, users: MentionUser[]): string[] {
  const ids: string[] = [];
  for (const u of users) {
    const needle = `@${u.label}`;
    if (text.includes(needle)) ids.push(u.id);
  }
  return [...new Set(ids)];
}

const MentionTextarea = forwardRef<HTMLTextAreaElement, Props>(function MentionTextarea(
  { value, onChange, users, placeholder, className, autoFocus, initialMentionIds = [] },
  _ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [openAt, setOpenAt] = useState<number | null>(null); // position du @
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  // Notifier le parent à chaque changement d'IDs (extraction depuis le texte)
  useEffect(() => {
    const ids = extractMentionIds(value, users);
    // Conserver les IDs initiaux qui sont encore présents dans le texte
    const merged = [...new Set([...ids])];
    // Évite de spammer onChange : appelé via handleChange uniquement
    // (cet effet ne déclenche pas onChange, juste utilitaire si besoin)
    void merged;
    void initialMentionIds;
  }, [value, users, initialMentionIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users.slice(0, 6);
    return users
      .filter((u) => u.label.toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q))
      .slice(0, 6);
  }, [users, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query, openAt]);

  function detectTrigger(text: string, caret: number) {
    // Chercher un @ avant le curseur, sans espace entre @ et caret
    let i = caret - 1;
    while (i >= 0) {
      const ch = text[i];
      if (ch === "@") {
        // Doit être en début ou précédé d'un espace/saut de ligne
        if (i === 0 || /\s/.test(text[i - 1])) {
          return { at: i, query: text.slice(i + 1, caret) };
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
      i--;
    }
    return null;
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const caret = e.target.selectionStart ?? next.length;
    const trig = detectTrigger(next, caret);
    if (trig) {
      setOpenAt(trig.at);
      setQuery(trig.query);
    } else {
      setOpenAt(null);
      setQuery("");
    }
    const ids = extractMentionIds(next, users);
    onChange(next, ids);
  }

  function insertMention(user: MentionUser) {
    if (openAt == null || !textareaRef.current) return;
    const ta = textareaRef.current;
    const caret = ta.selectionStart ?? value.length;
    const before = value.slice(0, openAt);
    const after = value.slice(caret);
    const insertion = `@${user.label} `;
    const next = before + insertion + after;
    const newCaret = (before + insertion).length;
    const ids = extractMentionIds(next, users);
    onChange(next, ids);
    setOpenAt(null);
    setQuery("");
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCaret, newCaret);
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (openAt == null || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(filtered[activeIdx]);
    } else if (e.key === "Escape") {
      setOpenAt(null);
    }
  }

  return (
    <div className="relative">
      <Textarea
        ref={(el) => {
          textareaRef.current = el;
        }}
        autoFocus={autoFocus}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpenAt(null), 150)}
        placeholder={placeholder}
        className={className}
      />
      {openAt != null && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-56 overflow-y-auto rounded-md border bg-popover shadow-lg">
          {filtered.map((u, idx) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(u);
              }}
              className={cn(
                "w-full text-left px-3 py-1.5 text-sm hover:bg-accent",
                idx === activeIdx && "bg-accent",
              )}
            >
              <span className="font-medium">{u.label}</span>
              {u.email && <span className="text-xs text-muted-foreground ml-2">{u.email}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default MentionTextarea;

/**
 * Rendu lecture seule : transforme les @label connus en badges.
 */
export function renderNoteContent(content: string, users: MentionUser[]): React.ReactNode {
  if (users.length === 0) return content;
  // Construire une regex sur les labels, longest first pour éviter chevauchements
  const sorted = [...users].sort((a, b) => b.label.length - a.label.length);
  const escaped = sorted.map((u) => u.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`@(${escaped.join("|")})(?!\\w)`, "g");
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    parts.push(
      <span
        key={`m-${key++}`}
        className="inline-flex items-center rounded px-1 py-0.5 text-[11px] font-medium bg-green-100 text-green-800 mx-0.5"
      >
        @{m[1]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts;
}
