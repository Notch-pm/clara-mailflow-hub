import { Navigate, useParams } from "react-router-dom";
import { useEluMode } from "@/contexts/EluModeContext";

/**
 * Permalien d'une réponse à viser (`/viser/:replyId`), porté par la cloche et
 * le push. Le serveur qui compose le push ne sait pas sur quel appareil il
 * sera ouvert : c'est ici, sur l'appareil, que l'on choisit l'écran — l'espace
 * élu sur téléphone, le parapheur ailleurs, la réponse présélectionnée.
 */
export function VisaPermalink() {
  const { replyId } = useParams<{ replyId: string }>();
  const { active } = useEluMode();
  if (!replyId) return <Navigate to="/" replace />;
  if (active) return <Navigate to={`/elu/reponse/${replyId}`} replace />;
  return <Navigate to={`/parapheur?onglet=visa&reponse=${encodeURIComponent(replyId)}`} replace />;
}
