/** Cadre en pointillés : la liste est bien chargée, elle est simplement vide. */
export function EluEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[--radius] border border-dashed px-5 py-8 text-center text-[17px] text-muted-foreground">
      {children}
    </p>
  );
}
