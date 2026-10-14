import { Stamp } from "lucide-react";
import { Input } from "@/components/ui/input";
import { visaPersonName } from "@/services/courierVisaService";

type Viseur = Parameters<typeof visaPersonName>[0] & { id: string };

interface Props {
  designated: Viseur | null;
  /** Aucun viseur rattaché à l'organisation : personne ne pourra viser. */
  noViseur: boolean;
  serviceName: string;
  /** L'utilisateur peut viser : il saisit son commentaire ici. */
  canVisa: boolean;
  currentUserId: string | null;
  comment: string;
  onCommentChange: (comment: string) => void;
  busy: boolean;
}

/** Étape de visa pas encore visée : qui est attendu, et le commentaire du viseur. */
export function VisaWaitingNotice({
  designated,
  noViseur,
  serviceName,
  canVisa,
  currentUserId,
  comment,
  onCommentChange,
  busy,
}: Props) {
  return (
    <div className="shrink-0 space-y-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
      <p className="flex items-center gap-2 text-sm">
        <Stamp className="h-4 w-4 shrink-0 text-warning" />
        {designated
          ? <>En attente du visa de <span className="font-medium">{visaPersonName(designated)}</span> (ou d'un autre viseur de l'organisation).</>
          : <>En attente du visa d'un viseur de l'organisation.</>}
      </p>
      {noViseur && (
        <p className="text-xs text-muted-foreground">
          Aucun viseur n'est rattaché à l'organisation « {serviceName} » : un administrateur doit en associer un.
        </p>
      )}
      {canVisa && (
        <>
          {designated && designated.id !== currentUserId && (
            <p className="text-xs text-muted-foreground">Vous visez à la place de {visaPersonName(designated)}.</p>
          )}
          <Input
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="Commentaire de visa (facultatif)"
            maxLength={500}
            className="h-8 text-sm"
            disabled={busy}
          />
        </>
      )}
    </div>
  );
}
