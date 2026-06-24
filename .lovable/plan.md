## Liaison de courriers : relances & sujets liés

### 1. Modèle de données

Nouvelle table `courier_relations` (l'actuelle `courier_links` est réservée aux intégrations externes type Arpège — on ne touche pas).

Colonnes :
- `id`, `organization_id`, `created_at`, `created_by`
- `source_courier_id` (uuid, FK couriers)
- `target_courier_id` (uuid, FK couriers)
- `relation_type` enum : `relance` | `sujet_lie`
- `note` (text, optionnel — pourquoi le lien)
- `created_via` enum : `manual` | `ai_suggestion`
- Contraintes : unique (`source`, `target`, `relation_type`), `source != target`, scope `organization_id`
- RLS multi-tenant + GRANT standards (anon non, authenticated oui, service_role all)

Le lien est **bidirectionnel logique** : à l'affichage on requête `source_courier_id = X OR target_courier_id = X`. Sémantique :
- `relance` : implique une direction (target = courrier maître, source = relance). On affiche "Relance de…" / "Relancé par…".
- `sujet_lie` : non orienté.

### 2. Détection automatique (à la création / analyse IA)

Pendant l'analyse IA d'un nouveau courrier entrant (déjà déclenchée à la création depuis le travail précédent), on ajoute une étape **"recherche de courriers similaires"** côté edge function :

Algorithme (sans embeddings, pour limiter coûts) :
1. Récupérer les courriers de la même `organization_id`, hors archivés, dans une fenêtre glissante (6 mois par défaut).
2. Calculer un score pour chaque candidat :
   - +50 pts si **même usager** (même `sender_usager_id` ou même email expéditeur)
   - +10 pts par **tag/mot-clé commun** (intersection sur tags + mots-clés extraits par l'IA)
   - Bonus récence (décroissance linéaire sur la fenêtre)
3. Garder le top N (5) au-dessus d'un seuil.
4. Stocker les suggestions dans une colonne `ai_suggested_links jsonb` sur `courier_analyses` (pas d'insertion auto dans `courier_relations`) : `[{ courier_id, score, reasons: ["même usager","3 mots-clés communs"] }]`.

Pas d'embeddings dans cette V1 — extensible plus tard si nécessaire.

### 3. UI — Détection en boîte aux lettres

Sur le détail d'un courrier en état "Boîte aux lettres" (et tant que non traité), afficher un **encart d'alerte** en haut si `ai_suggested_links` non vide :

```text
⚠ Courriers potentiellement liés détectés (3)
─────────────────────────────────────────────
 • [Ref 2026-0123] Demande de permis — Jean Dupont      [Lier comme relance] [Lier au sujet] [Ignorer]
   Raisons : même usager · 4 mots-clés communs
 • …
[Voir tout dans l'onglet Liens]
```

Actions inline créent une ligne dans `courier_relations`. "Ignorer" retire la suggestion (stockée par id dans une liste `dismissed_suggestions` sur le courrier).

### 4. UI — Onglet "Liens" (liaison manuelle, toute la vie du courrier)

Nouvel onglet dans `CourierDetail` (à côté de "Contenu", "Réponse", "Historique" …) : **"Liens"** avec badge compteur.

Contenu :
- **Section "Relances"** : liste des courriers liés en type `relance` (sens : ce courrier est maître / ce courrier est relance d'un autre). Chacun → carte avec ref, objet, date, expéditeur, lien vers le détail, action ✕ pour retirer.
- **Section "Sujets liés"** : idem pour `sujet_lie`.
- **Bouton "Lier un courrier"** ouvre une modale `LinkCourierDialog` :
  - Champ recherche (debounce) sur ref, objet, expéditeur — résultats triés par pertinence (mêmes critères que l'algo IA : usager commun > mots-clés communs > récence).
  - Toggle "Suggestions IA" affichant les `ai_suggested_links` en tête.
  - Sélection du type (`relance` / `sujet_lie`) + sens (pour relance : "Ce courrier est une relance de…" / "…est relancé par…").
  - Note optionnelle.
- Indicateur visuel `[IA]` sur les liens créés depuis une suggestion.

### 5. UI — Recherche manuelle hors IA

La modale "Lier un courrier" fonctionne sans IA : recherche full-text sur `couriers` (ref, objet, sender_name, content). Tri par récence + score de similarité simple (intersection tags / même usager) calculé côté client à partir des résultats Supabase.

Ajout d'un bouton secondaire **"Chercher des courriers similaires"** dans l'onglet Liens qui relance à la demande l'algorithme de scoring côté client (sans appel LLM) — utile pour les courriers anciens créés avant la feature.

### 6. Liste des courriers — indicateurs

- Badge 🔗 + nombre dans la liste des courriers (`CourierList`) si le courrier a au moins une relation.
- Filtre additionnel "A des relances" / "A des liens" dans les filtres de la BAL.

### 7. Services & fichiers à créer/modifier

**Nouveaux fichiers :**
- `src/services/courierRelationService.ts` — `getRelations(courierId)`, `addRelation(...)`, `removeRelation(id)`, `searchCouriersForLinking(query, currentCourierId)`, `computeSimilarity(courierId)` (côté client).
- `src/components/courier/CourierLinksTab.tsx` — onglet Liens.
- `src/components/courier/LinkCourierDialog.tsx` — modale de liaison.
- `src/components/courier/SimilarCouriersAlert.tsx` — encart BAL.
- `src/types/courierRelation.ts`.

**Modifs :**
- `supabase/migrations/<ts>_courier_relations.sql` : table + enum + RLS + GRANTs + ajout colonne `ai_suggested_links jsonb` et `dismissed_link_suggestions uuid[]` sur `couriers` (ou `courier_analyses`).
- `supabase/functions/analyze-courier/index.ts` : ajouter l'étape "find similar couriers" après l'analyse, peupler `ai_suggested_links`.
- `src/pages/CourierDetail.tsx` (ou équivalent) : ajouter l'onglet, l'encart en BAL.
- `src/components/courier/CourierList.tsx` : badge + filtre.

### 8. Détails techniques

- **Multi-tenant** : toute requête filtre par `organization_id` via header `x-org-id` ; RLS le double-check.
- **Edge function** : l'algo de scoring tourne dans `analyze-courier` (déjà en place), pas d'appel LLM additionnel — purement SQL/TS.
- **Performance recherche** : index sur `couriers(organization_id, created_at desc)` (sans doute déjà présent), index GIN sur tags pour intersection rapide.
- **Pas d'embeddings en V1** : laisse la porte ouverte à une V2 si la qualité des suggestions est insuffisante.
- **Réversibilité** : suppression d'une relation = simple `DELETE`, pas de cascade sur les courriers.

### Hors scope V1

- Embeddings vectoriels (peut être ajouté plus tard via `pgvector`).
- Vue "fil de discussion" agrégée (un thread unique regroupant N courriers) — on reste sur des liens binaires.
- Notifications push quand une suggestion apparaît (l'alerte UI suffit).
