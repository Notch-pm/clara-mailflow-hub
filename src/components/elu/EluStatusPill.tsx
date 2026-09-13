import { cn } from "@/lib/utils";

/**
 * Pastille d'état. Le jaune de la marque signale ce qui attend l'élu ; le gris
 * ne fait que rappeler l'état d'un courrier qu'il consulte.
 */
export function EluStatusPill({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "attente" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center self-start truncate rounded-full px-3 text-[13px] font-bold",
        tone === "attente"
          ? "bg-secondary text-secondary-foreground"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
