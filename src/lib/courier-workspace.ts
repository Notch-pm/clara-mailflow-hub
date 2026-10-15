/** Décisions pures de l'écran d'instruction d'un courrier (testées dans `src/test/lib/courier-workspace.test.ts`). */

import type { Json } from "@/integrations/supabase/types";

/**
 * `couriers.metadata` est un JSON libre : objet attendu, tout le reste vaut « vide ».
 * Accepte aussi les références allégées (`Record<string, unknown>`) que passent certains écrans.
 */
export function courierMetadata(metadata: unknown): Record<string, Json | undefined> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, Json | undefined>)
    : {};
}

/** Liste d'origine d'un courrier, d'après la catégorie de son état courant. */
export function originList(category: string | null | undefined, isOutbound: boolean) {
  if (isOutbound) return { label: "Courriers sortants", href: "/courriers-sortants" };
  switch (category) {
    case "processed":
      return { label: "Traités", href: "/courriers-traites" };
    case "archived":
      return { label: "Archivés", href: "/courriers-archives" };
    case "processing":
      return { label: "En instruction", href: "/courriers-en-instruction" };
    default:
      return { label: "À instruire", href: "/a-instruire" };
  }
}

export function formatLongDate(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function initialsOf(name: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return `${words[0].charAt(0)}${words.length > 1 ? words[words.length - 1].charAt(0) : ""}`.toUpperCase();
}

/**
 * Répartit les transitions sortantes de l'état courant : la nominale (`next`),
 * le retour (`previous`), et toutes les autres, rangées dans « Autres actions ».
 */
export function splitTransitions<T extends { id: string; kind: string | null }>(
  transitions: readonly T[] | null | undefined,
) {
  const list = transitions ?? [];
  const next = list.find((t) => t.kind === "next");
  const previous = list.find((t) => t.kind === "previous");
  const others = list.filter((t) => t.id !== next?.id && t.id !== previous?.id);
  return { next, previous, others };
}

/**
 * Phrase « envoyé le … » / « reçu par … le … » de l'en-tête, avec l'initiale
 * en capitale quand rien ne la précède.
 */
export function headerDatePhrase(
  verb: string,
  dateLabel: string | null,
): string | null {
  return dateLabel ? `${verb} le ${dateLabel}` : null;
}

/** Début de phrase : met la première lettre en capitale si aucun expéditeur ne précède. */
export function capitalizeFirst(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
