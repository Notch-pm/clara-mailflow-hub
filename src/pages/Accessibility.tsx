import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Accessibility() {
  useEffect(() => {
    document.title = "Déclaration d'accessibilité - Clara";
  }, []);

  const updatedAt = "22 mai 2026";

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="min-h-11">
            <Link to="/" aria-label="Retour à l'accueil">
              <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
              Accueil
            </Link>
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 prose prose-sm md:prose-base dark:prose-invert">
        <h1>Déclaration d'accessibilité</h1>
        <p className="text-muted-foreground">Dernière mise à jour : {updatedAt}</p>

        <p>
          <strong>Edilumen</strong> est une marque de l'entreprise <strong>Notch</strong>,
          éditeur du produit <strong>Clara</strong>. L'éditeur s'engage à rendre son
          service accessible, conformément à l'article 47 de la loi n° 2005-102 du
          11 février 2005.
        </p>
        <p>
          À cette fin, Notch met en œuvre la stratégie et les actions
          décrites ci-dessous pour le produit Clara.
        </p>
        <p>
          Cette déclaration d'accessibilité s'applique à l'application Clara
          de gestion électronique du courrier administratif, accessible à
          ses utilisateurs authentifiés (agents, gestionnaires et
          administrateurs des organisations clientes).
        </p>

        <h2>État de conformité</h2>
        <p>
          Clara est <strong>partiellement conforme</strong> avec le
          référentiel général d'amélioration de l'accessibilité (RGAA)
          version 4.1, en raison des non-conformités et dérogations listées
          ci-dessous. Le niveau visé est WCAG 2.1 niveau AA / RGAA standard.
        </p>

        <h2>Résultats des tests</h2>
        <p>
          Un audit interne de conformité a été réalisé sur l'application.
          Les principales corrections suivantes ont été apportées :
        </p>
        <ul>
          <li>Attribut <code>lang="fr"</code> défini sur la racine du document</li>
          <li>Noms accessibles ajoutés sur l'ensemble des boutons icônes</li>
          <li>Étiquettes associées aux champs de formulaire</li>
          <li>Un seul élément <code>&lt;main&gt;</code> par page et titres <code>&lt;h1&gt;</code> présents</li>
          <li>Navigation latérale et mobile structurées en listes sémantiques</li>
          <li>Indicateurs de focus visibles sur les éléments interactifs</li>
          <li>Cibles tactiles agrandies à 44×44 pixels minimum sur mobile</li>
          <li>Utilisation de <code>h-dvh</code> pour éviter les contenus tronqués sur mobile</li>
        </ul>

        <h2>Contenus non accessibles</h2>
        <h3>Non-conformités connues</h3>
        <ul>
          <li>
            Certains contrastes de texte sur fond atténué restent à vérifier
            et renforcer.
          </li>
          <li>
            L'éditeur de workflows (canevas graphique) n'est pas entièrement
            utilisable au clavier ni avec un lecteur d'écran.
          </li>
          <li>
            La visionneuse de documents (PDF et images numérisées) dépend
            d'un composant tiers dont l'accessibilité n'est pas garantie.
          </li>
          <li>
            Les courriers numérisés ne disposent pas systématiquement d'une
            alternative textuelle structurée au-delà du contenu OCR brut.
          </li>
          <li>
            Certaines animations ne respectent pas encore la préférence
            <code> prefers-reduced-motion</code>.
          </li>
        </ul>

        <h3>Dérogations</h3>
        <p>
          Les contenus issus de sources externes (courriers entrants
          numérisés, pièces jointes des usagers, intégrations partenaires
          telles qu'Arpège) peuvent ne pas être totalement accessibles. Une
          alternative peut être obtenue sur demande auprès de votre
          administrateur d'organisation.
        </p>

        <h2>Établissement de cette déclaration</h2>
        <p>
          Cette déclaration a été établie le {updatedAt}. Elle s'appuie sur
          un auto-audit réalisé par l'équipe Notch sur la base du RGAA 4.1.
        </p>

        <h2>Retour d'information et contact</h2>
        <p>
          Si vous n'arrivez pas à accéder à un contenu ou à un service, vous
          pouvez contacter Notch, éditeur de Clara, pour être orienté vers
          une alternative accessible ou obtenir le contenu sous une autre
          forme :
        </p>
        <ul>
          <li>
            Par e-mail :{" "}
            <a href="mailto:contact@notch.pm">contact@notch.pm</a>
          </li>
        </ul>

        <h2>Voies de recours</h2>
        <p>
          Si vous constatez un défaut d'accessibilité vous empêchant d'accéder
          à un contenu ou à une fonctionnalité du service, que vous nous le
          signalez et que vous ne parvenez pas à obtenir une réponse de notre
          part, vous êtes en droit de faire parvenir vos doléances ou une
          demande de saisine au Défenseur des droits.
        </p>
        <p>Plusieurs moyens sont à votre disposition :</p>
        <ul>
          <li>
            <a
              href="https://formulaire.defenseurdesdroits.fr/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Écrire un message au Défenseur des droits
            </a>
          </li>
          <li>
            <a
              href="https://www.defenseurdesdroits.fr/saisir/delegues"
              target="_blank"
              rel="noopener noreferrer"
            >
              Contacter le délégué du Défenseur des droits dans votre région
            </a>
          </li>
          <li>
            Envoyer un courrier par la poste (gratuit, sans affranchir) :
            <br />
            Défenseur des droits
            <br />
            Libre réponse 71120
            <br />
            75342 Paris CEDEX 07
          </li>
        </ul>
      </main>
    </div>
  );
}
