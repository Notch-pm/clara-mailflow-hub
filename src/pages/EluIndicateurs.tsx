import StatistiquesPage from "@/pages/StatistiquesPage";

/**
 * Les statistiques dans la coquille élu.
 *
 * La page est MONTÉE telle quelle, jamais dupliquée — mais elle ne porte pas sa
 * gouttière : dans l'application complète, c'est `main` qui la lui donne
 * (`p-4 md:p-6`). Sans ce cadre, elle toucherait les bords de l'écran.
 */
export default function EluIndicateurs() {
  return (
    <div className="px-5 pb-7 pt-6">
      <StatistiquesPage />
    </div>
  );
}
