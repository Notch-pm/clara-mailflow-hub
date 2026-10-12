import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, CircleAlert, Scale } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  ACK_LEGAL_REFERENCE,
  ACK_MENTIONS,
  type AckDetails,
  type AckMention,
  type AckServiceContact,
  defaultImplicitDecisionDate,
  DEFAULT_SILENCE_MONTHS,
  formatIsoDayFr,
  type SilenceMeaning,
} from "../../../supabase/functions/draft-reply/acknowledgment";

// Mentions obligatoires de l'accusé de réception (art. R112-5 CRPA) : la
// saisie destinée à l'assistant IA, et la liste de contrôle sous l'éditeur.
// La liste est celle que reçoit le prompt (`acknowledgment.ts`) : l'agent
// relit exactement ce que l'assistant a eu l'ordre d'écrire.

const SILENCE_OPTIONS: { value: SilenceMeaning | null; label: string }[] = [
  { value: "acceptation", label: "Acceptation implicite" },
  { value: "rejet", label: "Rejet implicite" },
  { value: null, label: "À préciser" },
];

function receivedDay(receivedAt: string | null | undefined): string | null {
  return receivedAt ? formatIsoDayFr(receivedAt.slice(0, 10)) : null;
}

/** Précisions demandées à l'agent quand l'assistant rédige un accusé de réception. */
export function AcknowledgmentFields({
  value,
  onChange,
  receivedAt,
}: {
  value: AckDetails;
  onChange: (next: AckDetails) => void;
  receivedAt: string | null | undefined;
}) {
  const set = (patch: Partial<AckDetails>) => onChange({ ...value, ...patch });
  const suggested = defaultImplicitDecisionDate(receivedAt);

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Scale className="h-3.5 w-3.5" aria-hidden="true" />
        Mentions obligatoires ({ACK_LEGAL_REFERENCE})
      </p>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Faute de réponse expresse, la demande sera réputée…</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sens du silence">
          {SILENCE_OPTIONS.map((o) => {
            const selected = (value.silence ?? null) === o.value;
            return (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => set({ silence: o.value })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="ack-implicit-date" className="mb-1 block text-xs text-muted-foreground">
          Date de naissance de la décision implicite
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="ack-implicit-date"
            type="date"
            value={value.implicitDecisionDate ?? ""}
            onChange={(e) => set({ implicitDecisionDate: e.target.value || null })}
            className="h-8 w-[170px] text-sm"
          />
          {suggested && value.implicitDecisionDate !== suggested && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={() => set({ implicitDecisionDate: suggested })}
            >
              Délai de droit commun : {formatIsoDayFr(suggested)}
            </Button>
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {DEFAULT_SILENCE_MONTHS} mois après la réception en règle générale ; de nombreuses démarches ont un
          autre délai ou un autre sens du silence — à vérifier.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
        <div>
          <label htmlFor="ack-missing-pieces" className="mb-1 block text-xs text-muted-foreground">
            Pièces ou informations manquantes (une par ligne, vide si aucune)
          </label>
          <Textarea
            id="ack-missing-pieces"
            value={value.missingPieces ?? ""}
            onChange={(e) => set({ missingPieces: e.target.value })}
            placeholder="Ex : justificatif de domicile de moins de trois mois"
            className="min-h-[60px] resize-none text-sm"
          />
        </div>
        <div>
          <label htmlFor="ack-missing-deadline" className="mb-1 block text-xs text-muted-foreground">
            Délai pour les produire
          </label>
          <Input
            id="ack-missing-deadline"
            value={value.missingPiecesDeadline ?? ""}
            onChange={(e) => set({ missingPiecesDeadline: e.target.value })}
            placeholder="Ex : 15 jours"
            disabled={!(value.missingPieces ?? "").trim()}
            className="h-8 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

interface MentionStatus {
  ok: boolean;
  /** Ce que Clara sait déjà pour cette mention ; `null` = rien à afficher. */
  value: string | null;
}

function statusOf(
  mention: AckMention,
  ack: AckDetails,
  receivedAt: string | null | undefined,
  service: AckServiceContact | null,
): MentionStatus {
  const pieces = (ack.missingPieces ?? "").trim();
  switch (mention.key) {
    case "dates": {
      const received = receivedDay(receivedAt);
      const implicit = formatIsoDayFr(ack.implicitDecisionDate ?? null);
      const parts = [
        `Réception : ${received ?? "non renseignée"}`,
        pieces
          ? "Décision implicite : délai courant à réception des pièces manquantes"
          : `Décision implicite : ${implicit ?? "à préciser"}`,
      ];
      return { ok: !!received && (!!implicit || !!pieces), value: parts.join(" · ") };
    }
    case "service": {
      const fields = [
        service?.name?.trim(),
        service?.address?.replace(/\s*\n\s*/g, ", ").trim(),
        service?.email?.trim(),
        service?.phone?.trim(),
      ];
      const missing = ["désignation", "adresse postale", "adresse électronique", "téléphone"]
        .filter((_, i) => !fields[i]);
      const known = fields.filter(Boolean).join(" · ");
      return {
        ok: missing.length === 0,
        value: [known, missing.length ? `Manque : ${missing.join(", ")}` : ""].filter(Boolean).join(" — ") || null,
      };
    }
    case "pieces":
      return pieces
        ? {
          ok: !!(ack.missingPiecesDeadline ?? "").trim(),
          value: `${pieces.split(/\n+/).filter((p) => p.trim()).length} pièce(s) · délai : ${
            (ack.missingPiecesDeadline ?? "").trim() || "à préciser"
          }`,
        }
        : { ok: true, value: "Aucune signalée" };
    case "silence":
      return ack.silence
        ? {
          ok: true,
          value: ack.silence === "acceptation"
            ? "Acceptation implicite → attestation (art. L232-3)"
            : "Rejet implicite → délais et voies de recours",
        }
        : { ok: false, value: "À préciser" };
  }
}

/** Rappel des mentions obligatoires, sous l'éditeur de la réponse. */
export function AcknowledgmentChecklist({
  ack,
  receivedAt,
  service,
  highlighted,
  className,
}: {
  ack: AckDetails;
  receivedAt: string | null | undefined;
  service: AckServiceContact | null;
  /** Ouvre la liste quand l'agent rédige un accusé de réception. */
  highlighted: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(highlighted);
  useEffect(() => {
    if (highlighted) setOpen(true);
  }, [highlighted]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-md border", className)}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-muted/50"
        >
          <Scale className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          Accusé de réception : mentions obligatoires
          <span className="text-xs font-normal text-muted-foreground">({ACK_LEGAL_REFERENCE})</span>
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-2.5 border-t px-3 py-3">
          {ACK_MENTIONS.map((m) => {
            const status = statusOf(m, ack, receivedAt, service);
            return (
              <li key={m.key} className="flex gap-2 text-sm">
                {status.ok
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Renseigné" />
                  : <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-label="À compléter" />}
                <div className="min-w-0">
                  <p className="font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground">{m.detail}</p>
                  {status.value && <p className="mt-0.5 text-xs">{status.value}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">
          Un accusé de réception incomplet rend les délais de recours inopposables au demandeur (art. L112-6 CRPA).
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
