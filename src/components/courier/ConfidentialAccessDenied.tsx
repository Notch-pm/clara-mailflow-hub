import { useQuery } from "@tanstack/react-query";
import { Building2, Lock } from "lucide-react";
import { getCourierAccess } from "@/services/courierService";

/**
 * Détail d'un courrier confidentiel ouvert par quelqu'un qui n'y a pas accès
 * (lien de notification, liste, adresse copiée) : on dit pourquoi, sans rien
 * révéler du courrier.
 */
export function ConfidentialAccessDenied({ className }: { className?: string }) {
  return (
    <div className={className ?? "flex flex-col items-center gap-3 p-10 text-center"}>
      <div className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <Lock className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="text-base font-bold">Courrier confidentiel</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        Son contenu est réservé aux membres habilités, et aux viseurs et signataires désignés sur ses
        réponses. Si vous devez le traiter, demandez l'accès à un administrateur.
      </p>
    </div>
  );
}

/**
 * Détail d'un courrier d'une organisation dont on n'est pas membre (lien
 * copié, notification d'avant un transfert) : la base le refuse, on dit pourquoi.
 */
export function OutOfScopeAccessDenied({ className }: { className?: string }) {
  return (
    <div className={className ?? "flex flex-col items-center gap-3 p-10 text-center"}>
      <div className="grid h-11 w-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <Building2 className="h-5 w-5" aria-hidden="true" />
      </div>
      <h2 className="text-base font-bold">Courrier d'une autre organisation</h2>
      <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
        Il est traité par une organisation dont vous n'êtes pas membre. Si vous devez y accéder, demandez à un
        administrateur de vous y rattacher.
      </p>
    </div>
  );
}

/**
 * Une fiche qui ne se charge pas : confidentiel ou hors périmètre (on le dit) ou absent (le
 * message habituel de l'écran, `fallback`). La raison vient de la base.
 */
export function CourierUnavailable({
  courierId,
  fallback,
  className,
}: {
  courierId: string | null | undefined;
  fallback: React.ReactNode;
  className?: string;
}) {
  const { data: access } = useQuery({
    queryKey: ["courier-access", courierId],
    queryFn: () => getCourierAccess(courierId!),
    enabled: !!courierId,
  });
  if (access === "confidential") return <ConfidentialAccessDenied className={className} />;
  if (access === "out_of_scope") return <OutOfScopeAccessDenied className={className} />;
  return <>{fallback}</>;
}
