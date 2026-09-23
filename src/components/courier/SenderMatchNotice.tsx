import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, UserPlus, UserSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { DUPLICATE_REASON_LABELS, type DuplicateReason } from "@/lib/contact-duplicates";
import type { SocleContact } from "@/services/socleContactService";
import {
  SENDER_CONFLICT_LABELS,
  type SenderMatch,
  type SenderMatchConflict,
} from "../../../supabase/functions/_shared/senderMatchLogic";

interface Props {
  match: SenderMatch<SocleContact>;
  /** Le contact rapproché est celui qui sera rattaché au courrier. */
  selected: boolean;
  /** Rattacher le contact proposé (nom proche) ou revenir au contact reconnu. */
  onUse?: () => void;
  /** Écarter le contact reconnu : une nouvelle fiche sera créée. */
  onCreateInstead?: () => void;
  /** Rendu resserré pour la table de l'import en masse. */
  compact?: boolean;
}

function reasonsText(reasons: string[]): string {
  return reasons
    .map((r) => DUPLICATE_REASON_LABELS[r as DuplicateReason])
    .filter(Boolean)
    .join(", ");
}

function conflictDetail(conflict: SenderMatchConflict, c: SocleContact): string {
  const onFile =
    conflict === "email"
      ? c.email
      : conflict === "phone"
        ? [c.mobile_phone, c.landline_phone].filter(Boolean).join(" / ")
        : c.display_name;
  return `${SENDER_CONFLICT_LABELS[conflict]}${onFile ? ` (fiche : ${onFile})` : ""}`;
}

function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="underline underline-offset-2 hover:text-foreground transition-colors"
    >
      {children}
    </button>
  );
}

/**
 * État du rapprochement de l'expéditeur avec le référentiel, commun à l'import
 * unitaire et à l'import en masse : contact reconnu (avec alerte si l'email,
 * le téléphone ou le nom divergent de la fiche), nom proche à confirmer, ou
 * contact reconnu écarté par l'agent.
 */
export default function SenderMatchNotice({ match, selected, onUse, onCreateInstead, compact }: Props) {
  const contact = match.contact;
  if (!contact || match.status === "none") return null;
  const name = contact.display_name ?? "contact sans nom";
  const text = compact ? "text-[10px]" : "text-xs";
  const icon = compact ? "h-3 w-3" : "h-3.5 w-3.5";

  if (selected && match.conflicts.length > 0) {
    return (
      <div
        role="alert"
        className={cn(
          "rounded border border-warning/50 bg-warning/10 text-foreground",
          compact ? "px-1.5 py-1" : "px-3 py-2",
          text,
        )}
      >
        <div className="flex items-start gap-1.5">
          <AlertTriangle className={cn(icon, "shrink-0 mt-px text-warning")} />
          <div className="space-y-0.5">
            <p>
              Reconnu : <span className="font-medium">{name}</span>
              {match.reasons.length > 0 && <> — {reasonsText(match.reasons)}</>}
            </p>
            {match.conflicts.map((c) => (
              <p key={c}>Attention : {conflictDetail(c, contact)}</p>
            ))}
            {onCreateInstead && (
              <LinkButton onClick={onCreateInstead}>Créer plutôt un nouveau contact</LinkButton>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <p className={cn("flex items-center gap-1 text-success", text)}>
        <CheckCircle2 className={cn(icon, "shrink-0")} />
        <span>
          Reconnu : <span className="font-medium">{name}</span>
          {match.reasons.length > 0 && <> — {reasonsText(match.reasons)}</>}
        </span>
      </p>
    );
  }

  if (match.status === "suggested") {
    return (
      <div className={cn("flex items-start gap-1 text-muted-foreground", text)}>
        <UserSearch className={cn(icon, "shrink-0 mt-px")} />
        <span>
          Nom proche dans le référentiel : <span className="font-medium text-foreground">{name}</span>
          {onUse && (
            <>
              {" "}
              <LinkButton onClick={onUse}>C'est cette personne</LinkButton>
            </>
          )}
        </span>
      </div>
    );
  }

  // Contact reconnu, mais l'agent a choisi d'en créer un nouveau.
  return (
    <div className={cn("flex items-start gap-1 text-muted-foreground", text)}>
      <UserPlus className={cn(icon, "shrink-0 mt-px")} />
      <span>
        Nouveau contact à la place de <span className="font-medium text-foreground">{name}</span>
        {onUse && (
          <>
            {" "}
            <LinkButton onClick={onUse}>Annuler</LinkButton>
          </>
        )}
      </span>
    </div>
  );
}
