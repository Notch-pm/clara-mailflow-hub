# Backlog produit

> **Public** : PO et équipe Clara · **Question traitée** : qu'est-ce qui a été demandé, pas
> encore arbitré, et que faut-il savoir avant de s'y mettre ? · **Dernière mise à jour** :
> 2026-11-06

Ce document porte les demandes **produit** en attente. Il ne double pas
[`technical-debt.md`](technical-debt.md), qui traite de la dette technique. Chaque entrée dit
ce qui existe déjà (vérifié dans le code), ce qui manque, et les questions ouvertes. **Aucune
n'est arbitrée** — les pistes citées sont des pistes. Une entrée réalisée quitte ce document
pour [`features.md`](features.md).

## Client Vernon (présentation GRU du 2026-10-30)

Prospect chaud : la **ville de Vernon et Seine Normandie Agglomération** (SNA) cherchent une
gestion du courrier intégrée à la relation usager ; SNA réévalue le marché à cause des
restrictions de FranceConnect V2. Délai de réponse attendu à Vernon : **quinze jours**. La
démonstration a porté sur Clara : canaux d'entrée, courrier à plusieurs demandes, IA
(titre, métadonnées, actions, réponse), orientation, visa et signature. Toutes les entrées
ci-dessous sont **🏷 Vernon**, vérifiées dans le code le 2026-11-04.

Aussi lié à Vernon : l'annuaire des agents dans le Socle (`Socle/docs/roadmap.md`
§ « Annuaire des agents ») et `Iris/docs/backlog.md` § « Client Vernon » (B3, B5, B15–B17).

**Déjà couvert, à montrer tel quel** : boîtes IMAP, papier numérisé (`is_scan_inbox`),
formulaire en ligne (`portal-form`, courrier libre Nora), courrier relayé par un élu
(`relaye_elu`, espace `/elu/*`) ; extraction d'actions et demandes Iris préremplies
(`action_tickets`, `push-iris-request`) ; tâches internes (`kind = 'tache'`) ; « Améliorer mon
message » (`improve-reply`, la langue jamais le sens) ; visa (`courier_visas`, Parapheur) et
signature image ; délais d'AR et de traitement par organisation (`sla_*_business_days`) ;
courriers liés (`courier_relations`, `relance` / `sujet_lie`).

---

## C1 — Modèles de réponse validés par la collectivité · 🏷 Vernon

**Engagement pris en séance le 2026-10-30** : utiliser des **modèles de courriers communaux
validés** pour stabiliser les réponses générées par l'IA.

**Ce qui existe** : un seul **modèle de mise en page** (papier à en-tête) par collectivité,
`organizations.reply_template_html` / `reply_template_design`, éditeur Unlayer
(`src/pages/ModeleSettings.tsx`), fusion Handlebars à l'impression (`src/utils/printReply.ts`).
**Aucune bibliothèque de corps de réponse** (ni table, ni écran). `draft-reply` ne lit aucun
modèle : son cahier des charges est codé en dur par type (`RESPONSE_TYPES`,
`supabase/functions/draft-reply/logic.ts`).

**L'ajustement** :
1. Une bibliothèque de **modèles de réponse** (corps de texte, variables), validés et
   activés par organisation, rattachables à un thème ou à un type de réponse.
2. Un brouillon IA **à partir d'un modèle choisi** : l'IA adapte au courrier ce que le
   modèle laisse ouvert, sans réécrire les passages validés.

**Questions ouvertes** : qui valide et quelle trace ; comment garantir que le texte validé
n'est pas réécrit (zones marquées, contrôle serveur, à l'image du contrôle de jetons
d'`improveMessage.ts`) ; rapprocher le catalogue de variables de celui des modèles d'e-mail
d'Iris (`{{groupe.cle}}`) ou non.

**Touche** : migration (table de modèles), `src/pages/ModeleSettings.tsx`,
`supabase/functions/draft-reply/`, `src/components/courier/outbound/`.

## C2 — Service pilote et réponse globale · 🏷 Vernon

**Demandé le 2026-10-30** : un courrier à plusieurs demandes relève de plusieurs
compétences ; un **service pilote** centralise les contributions des autres services en une
**réponse globale**.

**Ce qui existe** : une seule organisation gestionnaire par courrier
(`couriers.socle_organization_id`), suggestion IA du service (`_shared/serviceSuggestion.ts`),
routage par le service courrier, transfert, renvoi au service courrier. Une action peut viser
une autre organisation que celle du courrier (`action_tickets.socle_organization_id`). **Rien
pour les contributions** : ni service contributeur, ni avis attendu, ni consolidation.

**Piste** : le service gestionnaire devient le pilote ; une **contribution** demandée à un
autre service (proche de la tâche interne, avec un texte rendu et une échéance) apparaît dans
le panneau de rédaction, et `draft-reply` la prend en compte comme il lit déjà les tâches.

**Questions ouvertes** : la contribution est-elle une tâche (`kind = 'tache'`) enrichie ou un
objet distinct ; le service contributeur voit-il le courrier entier (droits, RLS) ; que
devient la réponse si une contribution manque à l'échéance.

**Touche** : `action_tickets` ou nouvelle table, RLS, `CreateTaskDialog.tsx`,
`supabase/functions/draft-reply/`.

## C3 — Délais : alertes et précision · 🏷 Vernon

**Demandé le 2026-10-30** : quinze jours de réponse à Vernon ; conséquences réglementaires
des délais (urbanisme).

**Ce qui existe** : délais d'AR et de traitement **par organisation**, en jours ouvrés,
hérités du parent (`20261001070242_delais_de_traitement.sql`) ; faits `acknowledged_at` /
`resolved_at` ; échéance calculée côté client (`src/lib/courier-sla.ts`), affichée (colonne,
carte, pastille de retard) et dans les statistiques. `features.md` dit lui-même « Pas encore :
filtre en retard côté serveur, alertes ».

**L'ajustement** :
1. **Alertes** d'échéance proche / dépassée (notifications), et filtre « en retard » côté
   serveur.
2. Un délai par **type de courrier ou thème** quand la loi en impose un autre (urbanisme), en
   plus du délai par organisation.

**Questions ouvertes** : les « quinze jours » de Vernon sont-ils ouvrés ou calendaires (le
réglage actuel est en jours ouvrés) ; envoi automatique de l'accusé de réception (absent
aujourd'hui) — souhaité ou non ; relance automatique du service (écartée le 2026-10-09 pour
les tâches, à rediscuter).

**Touche** : notifications, `src/lib/courier-sla.ts`, RPC de liste, migration éventuelle.

## C4 — Analyse de sentiment : finalité RGPD · 🏷 Vernon

**Soulevé le 2026-10-30, non tranché** : la qualification des sentiments interroge le RGPD et
sa finalité ; alternatives citées : indicateurs objectifs, ou évaluation exprimée par l'usager.

**Ce qui existe** : les sentiments sont des **tags du groupe `sentiment`** de l'organisation
(`20260910180000_tags_groupes_theme_sentiment.sql`), choisis par l'IA parmi la liste de
l'organisation (`_shared/courierAnalysisCore.ts`), affichés sur le courrier et en courbe
(`stats_tag_evolution`). La doc **ne dit rien** de leur finalité ni du RGPD.

**L'ajustement** :
1. **Documenter la finalité** (pourquoi on qualifie le ton, qui le voit, combien de temps) et
   la faire valider avant de vendre la fonction.
2. Permettre à une collectivité de **ne pas qualifier le sentiment** — à vérifier : une
   organisation sans tag `sentiment` y échappe-t-elle déjà entièrement (prompt, stockage,
   statistiques) ?
3. Proposer des **indicateurs objectifs** (délais, relances, courriers liés sur un même sujet)
   et, côté Iris, la satisfaction déclarée par l'usager (`Iris/docs/backlog.md` B17).

**Touche** : `docs/security.md`, `_shared/courierAnalysisCore.ts`,
`src/pages/ClassificationSettings.tsx`.

## C5 — Courrier signé en PDF · 🏷 Vernon

**Montré le 2026-10-30** : visa et signature dans le workflow.

**Ce qui existe** : visa complet (`courier_visas`, `requires_visa`, Parapheur, `/viser/:id`) ;
signature = **image PNG** insérée dans le HTML (`signatories`, bucket `signatures`) ; « PDF »
= `window.print()` du navigateur (`src/utils/printReply.ts`) ; l'envoi par
`send-courier-reply` part en HTML, **sans la lettre gabariée en PDF**. La spec des sortants
classe PDF et signature qualifiée hors périmètre (`docs/specs/courriers-sortants.md:97`).

**L'ajustement à instruire** : génération serveur du PDF de la lettre (modèle + signature),
jointe à l'envoi et conservée — c'est la question **Q8** de l'architecture d'Iris (« qui sait
signer et produire un PDF gabarié »), attribuée à Clara. Signature électronique qualifiée :
à demander au client avant de chiffrer.

**Touche** : nouvelle edge function, `send-courier-reply`, stockage.

## C6 — Dossier regroupant plusieurs courriers · 🏷 Vernon

**Évoqué le 2026-10-30** : rattacher des courriers à des **sujets communs**.

**Ce qui existe** : liens de courrier à courrier (`courier_relations`, `relance` /
`sujet_lie`), suggestions par heuristique client (`computeSimilarCouriers` — pas de LLM,
malgré `created_via = 'ai_suggestion'`). **Aucune entité « dossier »** qui regroupe N
courriers.

**Question à poser au client** : les liens suffisent-ils (montrés en séance), ou attend-il un
dossier nommé, avec son service pilote (C2) et une réponse commune ?

## C7 — Tâches : échéance · 🏷 Vernon

**Ce qui existe** : tâches internes (`action_tickets.kind = 'tache'`, `open` / `done`,
affectation membre / contact / e-mail, clôture sans connexion). **Pas d'échéance**, pas de
sous-tâche, relance manuelle seulement (choix du 2026-10-09).

**L'ajustement** : une échéance facultative sur la tâche, visible dans la liste et dans les
délais du courrier (C3). Voisin d'Iris B5 (les interventions d'Iris ont une date souhaitée).

## C8 — Suivi pour l'élu qui relaie · 🏷 Vernon

**Évoqué le 2026-10-30** : les demandes transmises par un élu ; les besoins des élus.

**Ce qui existe** : canal `relaye_elu`, saisie mobile `/elu/nouveau-courrier`,
`metadata.relayed_by` écrit par `src/services/eluRelayService.ts`, espace `/elu/*`. Mais
**`relayed_by` n'est lu par aucun écran** : pas de « mes courriers relayés », pas d'avis à
l'élu quand son courrier avance.

**L'ajustement** : une liste « Courriers que j'ai relayés » dans l'espace élu, et un avis
d'avancement (réponse envoyée, clôture). À confirmer avec le client : c'est ce que « les
besoins des élus » visait-il ?

---

## Envois papiers réels (Merci Facteur)

Livrés et recettés le 2026-11-06 (compte Merci Facteur en sandbox) : voir `features.md`
§ « Envois papiers réels ». **Un seul compte Merci Facteur, celui de Notch**, qui
refacture les collectivités.

## P1 — Suivi de la facturation Merci Facteur

**Demandé le 2026-11-06.**

**Ce qui existe** : chaque envoi par le prestataire garde son prix dans `postal_sendings`
(`price_ht`, `price_ttc`, `nb_pages`, `mode`, `provider_envoi_id`, `sent_at`, par
`organization_id`). Paramètres → Envois papiers montre aux administrateurs de la collectivité
les 50 derniers envois et le **total TTC du mois** (`monthTotalTtc`,
`src/lib/postal-sending.ts`). Un plafond d'envois par 24 h existe (`postal_daily_cap`), mais
aucun plafond en euros.

**Ce qui manque** :
- **Pour Notch** : aucune vue toutes collectivités confondues. Il faudrait une vue réservée au
  superadmin, avec le total HT/TTC par collectivité et par mois, un export pour la
  refacturation, et le détail par envoi (date, référence du courrier, type, pages, prix).
- **Rapprochement avec Merci Facteur** : rien ne vérifie que la somme des prix enregistrés
  égale la facture du compte Notch. Les envois « à vérifier » (`to_verify`, issue incertaine)
  n'ont pas de prix : s'ils sont partis, ils sont facturés chez Merci Facteur sans l'être dans
  Clara. L'API offre `listEnvois` / `getEnvoi`, ainsi que `getQuotaCompte` pour l'état du
  compte. La réponse de `sendCourrier` porte aussi `account.pages` (`thisMonth`,
  `maxMonth`), que Clara ne garde pas aujourd'hui.
- **Pour la collectivité** : pas d'historique au-delà des 50 derniers envois, pas d'export,
  pas de budget ni d'alerte de dépassement.

**Questions ouvertes** :
- La refacturation se fait-elle au prix coûtant (le `price_ttc` de Merci Facteur) ou avec une
  marge, ou un forfait ? Le prix montré à la collectivité doit-il être celui-là ?
- Quel rythme et quel format pour Notch : export mensuel CSV, écran, envoi automatique ?
- Les **tarifs affichés avant l'envoi** (aide de la fenêtre d'envoi, Paramètres) sont en
  attente de la grille, demandés le 2026-11-06. Une grille fixe ou le devis exact
  `getPostagePrice` : le choix rejoint celui de la refacturation.

