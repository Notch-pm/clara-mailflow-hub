import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { EluHeader } from "@/components/elu/EluHeader";
import { EluTabBar } from "@/components/elu/EluTabBar";
import { useEluSignatureQueue } from "@/hooks/useEluSignatureQueue";
import { useScrollMemory } from "@/hooks/useScrollMemory";

/**
 * Coquille de l'espace élu : un en-tête, UNE seule zone défilante, une barre
 * d'onglets. Rien ne flotte par-dessus le contenu — le pied d'action de l'écran
 * de signature se pose dans le flux, en `sticky`, pour que la barre d'URL de
 * Safari iOS ne vienne pas le recouvrir.
 */
export function EluLayout() {
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollMemory(scrollRef);
  // Même hook que l'écran « À signer », donc même cache : le badge ne déclenche
  // pas une seconde série de requêtes.
  const { count } = useEluSignatureQueue();

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <EluHeader />
      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        <Outlet />
      </div>
      <EluTabBar signatureCount={count} />
    </div>
  );
}
