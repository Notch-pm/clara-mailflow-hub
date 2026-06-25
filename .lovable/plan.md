# Refonte de la structure des écrans courrier

## 1 — Analyse de la maquette

Votre maquette propose de :
- Remonter les métadonnées principales (Date de réception, Canal, Expéditeur, Destinataire, Tags, Service gestionnaire) dans une **carte d'entête** sous le titre du courrier.
- Supprimer la colonne gauche `aside` actuellement présente dans l'onglet **Détail du courrier**, qui devient alors plein largeur (juste l'Aperçu + Documents).
- Conserver les onglets (Détail / Contenu et intentions / Actions liées / Réponse / Participants / Liens / Historique) mais sans encart latéral fixe.

Cela apporte deux gains réels :
- Les infos clés du courrier restent visibles **quel que soit l'onglet actif** (alors qu'aujourd'hui elles disparaissent dès qu'on quitte "Détail").
- L'aperçu du courrier (souvent un email forwardé) gagne ~360 px de large.

C'est donc pertinent à implémenter.

## 2 — Plan d'implémentation

### Composant impacté
`src/components/courier/MailboxSidePanel.tsx` — le composant unique utilisé en plein écran (`CourierDetail`) et historiquement en side panel.

### Changements

**A. Nouvelle carte d'entête (sous le titre, au-dessus des onglets)**

Layout type 3 colonnes (responsive : empilage en mobile) :

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Date réception]  24/06/2026   [Expéditeur (nom)]  Laurent Jacquot   │  [Tags : usager voirie …]
│ [Canal réception] Courriel     [Destinataire (nom)] —                │
│                                                                       │  [Service gestionnaire : Cabinet du Maire ⇄]
└──────────────────────────────────────────────────────────────────────┘
```

- Réutilise `InlineEditField` pour les champs éditables (pas de duplication de logique).
- Le bouton "Transférer à un autre service" (icône ⇄) reste accessible à côté du service gestionnaire.
- Pour les courriers **sortants** : variante avec Date d'envoi + lien vers le courrier entrant parent.
- Conserve `readOnly` (mode archive) qui désactive l'édition inline.

**B. Onglet "Détail du courrier" simplifié**

- Suppression du `<aside class="lg:border-r">` (métadonnées) et du `grid lg:grid-cols-[360px_1fr]`.
- Le contenu droit (Aperçu / Corps de l'email / pagination Préc/Suiv / Documents) prend toute la largeur.
- Tout le bloc Service gestionnaire / Transfert / Tags qui est aujourd'hui dans `aside` est déplacé dans la carte d'entête (Tags + Service), ou supprimé du Détail s'il est désormais dans l'entête.

**C. Préservation des comportements existants**

- Boutons de transition (Précédent / Suivant / Autres actions) restent en haut à droite, comme aujourd'hui.
- Badge de statut reste accolé au titre.
- Bouton retour (flèche gauche) inchangé.
- Panneau flottant "Notes" (languette ambrée) inchangé.
- Onglet Contenu et intentions, Actions liées, Réponse, Participants, Liens, Historique : **aucune modification**.

**D. Responsive**

- Desktop ≥ lg : 3 colonnes (date+canal | expéditeur+destinataire | tags+service).
- < lg : empilement vertical des 3 blocs, avec wrap des tags.

### Hors scope (à confirmer si vous voulez l'inclure)

- Renommage / réorganisation des onglets (vous parlez d'évolution des onglets dans le message mais la maquette les conserve à l'identique).
- Modifications visuelles du panneau de réponse, des actions liées, etc.

## 3 — Vérification

Après implémentation, vérification par capture Playwright sur `/courrier/:id` (entrant et sortant) que :
1. Les métadonnées sont bien lisibles dans l'entête.
2. L'onglet Détail est bien plein-largeur.
3. L'édition inline (titre, date, expéditeur…) fonctionne toujours.
4. Aucune régression visuelle dans les autres onglets.
