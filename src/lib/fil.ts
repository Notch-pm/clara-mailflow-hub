/** « 12/09/2026 à 14:05 · Claire Agent » */
export function filMeta(at: string | null | undefined, by?: string | null): string | null {
  const when = at
    ? new Date(at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(" ", " à ")
    : null;
  return [when, by].filter(Boolean).join(" · ") || null;
}
