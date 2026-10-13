# Courriers sortants à l'initiative de la collectivité

> Spécification (Cécile, analyse métier) et architecture (Loïc, architecture) du 2026-10-13,
> **validées par le PO le 2026-10-13**. Aucune ligne de code n'est encore écrite.
> Les vérifications en base live (§ 12) ont été faites le même jour.
>
> **Avancement** : lot 0 livré le 2026-10-13 (`OutboundEditor` extrait de `ReplyComposer`,
> historique ancré par `eventAnchor` dans `src/lib/courier-events.ts`). Les 555 sortants
> `seed_bulk` d'ACCM ont été purgés et le script de charge ne génère plus que des entrants.
> **Lot 1 livré le 2026-10-13** : migrations appliquées, `NewOutboundDialog`, `InitiativeComposer`
> (onglet « Rédaction »), colonne Type. Écarts : la création rapide de contact gagne un champ
> adresse (`ContactPicker withAddress`) au lieu d'extraire `ContactFormDialog` ; le mode d'envoi se
> règle dans l'éditeur (radio « Canal ») ; l'assistant « type de réponse » est masqué pour un
> courrier à l'initiative jusqu'au lot 3 (« Améliorer » reste disponible).
> **Lot 2 livré le 2026-10-13** : envoi par courriel (réservation atomique, PJ, échecs tracés), clôture
> d'un courriel non parti refusée. Les PJ restent réservées aux courriers à l'initiative.
> **Lot 3 livré le 2026-10-13** : assistant sur consigne (mode `initiative` de `draft-reply`), lit le
> brouillon de l'éditeur et les courriers liés, jamais les notes internes.
> **Lot 4 livré le 2026-10-13** : « Imprimer et marquer posté » (date déclarée, exemplaire HTML
> conservé, `sent_at` fixé par la base). La garde de clôture couvre désormais courriel ET courrier.
> **Lot 5 livré le 2026-10-13 — chantier terminé.** Liens vers les courriers reçus depuis l'onglet
> Liens, tracés des deux côtés ; départ (courriel, « posté ») recopié sur les courriers liés. Écart :
> pas de lien à la création (le formulaire reste court) — il se pose depuis l'onglet Liens.
> Écart au plan : pas de hook `useOutboundComposer` séparé — l'éditeur porte son état ; à
> extraire au lot 1 seulement si `InitiativeComposer` en a besoin.
> **Écran par état, 2026-10-13.** `/courriers-sortants` n'est plus un tableau plat : gabarit de
> « Courrier entrant », onglets En rédaction / visa / signature / Prêt à l'envoi / Envoyés / Tous.
> Envoyé = `sent_email_at` ou `posted_at` ou état final — jamais `sent_at` seul (leurre, ADR-4) ;
> signé hors étape d'envoi = prêt à l'envoi. Règle : `src/lib/outbox.ts` ; données : RPC
> `outbound_couriers` (`20261013142643_courriers_sortants_ecran.sql`) ; panneau : `ParapheurDetail`.

## 1. Besoin

Une organisation doit pouvoir **écrire en premier** à un usager ou à un partenaire (convocation,
information, relance, courrier d'élu), sans créer un faux courrier entrant. Le courrier :

- est créé depuis **Courriers sortants** ;
- a pour destinataire **une** fiche du référentiel des contacts (Socle), créable sur place ;
- est rédigé à la main ou par l'**assistant** à partir d'une consigne libre ;
- part par **courriel** (serveur d'envoi du Socle) ou par **courrier postal** ;
- suit le **workflow réponse de l'organisation qui l'émet** (visa, signature, envoi) ;
- est numéroté au registre `S` et tracé dans son propre historique.

## 2. Existant

Un sortant est une ligne `couriers` avec `direction = 'outbound'`. Aujourd'hui ce sont presque
toujours des **réponses** (`parent_courier_id` renseigné). Le sortant « autonome » créé depuis
`/courriers-sortants` n'est qu'une coquille : objet, canal, date, sans destinataire, organisation,
corps ni état (`src/pages/CourriersSortants.tsx:46-50, 115-134`).

| Sujet | Existant | Source |
|---|---|---|
| Numéro | `AAAA-S-NNNNN`, compteur par tenant, année et sens, posé à l'INSERT | `migrations/20260913090832_courier_chrono.sql:66-81` |
| Workflow réponse | `socle_organizations.reply_workflow_id`, réglé par l'administrateur | `docs/data-model.md`, `OrganizationConfigDialog.tsx` |
| Garde des transitions | sortant avec `socle_organization_id` → workflow réponse, parent ou non ; état NULL accepté | `docs/garde-transitions-workflow.md`, `20260723101849_courier_transition_guard.sql` |
| Garde de création | ne joue que si `parent_courier_id` est renseigné | `20260924190000_garde_creation_action_reponse.sql:59-65` |
| Composeur | `ReplyComposer` : canaux, objet, corps, signataire, visa, transitions, impression — **lié au parent** | `src/components/courier/ReplyComposer.tsx` |
| IA | `draft-reply` via le guichet du Socle, prompt construit **depuis le courrier reçu** | `supabase/functions/draft-reply/index.ts` |
| Envoi courriel | `send-courier-reply` : un destinataire, pas de pièce jointe, événement seulement si parent | `supabase/functions/send-courier-reply/index.ts` |
| Envoi postal | aucun ; impression navigateur, rien n'est stocké, pas de marqueur « posté » | `src/utils/printReply.ts:231-245` |
| `sent_at` | posé dès la création pour satisfaire `check_dates` (leurre) | `src/services/courierReplyService.ts:108-111` |
| Historique | événements écrits **sur le parent** | `courierReplyService.ts` |
| Parapheur | `loadApprovalContext` échoue sans parent | `src/services/replyApprovalService.ts:102` |
| Tableau de bord | brouillons sans parent exclus | `src/services/dashboardService.ts:40` |
| Contacts | proxy `socle-contacts` (liste, rapprochement, création) ; la création rapide de `ContactPicker` ne saisit pas l'adresse | `src/services/socleContactService.ts`, `ContactPicker.tsx:97-146` |

## 3. Décisions du PO (2026-10-13)

Toutes les recommandations de l'analyse ont été retenues.

| # | Question | Décision |
|---|---|---|
| Q1 | Écran dédié ou moteur commun ? | **Moteur commun** extrait de `ReplyComposer`. |
| Q2 | Organisation sans workflow réponse | **Création refusée**, garantie côté serveur, message qui nomme l'organisation. |
| Q3 | Nombre de destinataires | **Un seul**, pas de copie. |
| Q4 | Destinataire hors référentiel | **Interdit** : fiche Socle obligatoire, créable sur place. |
| Q5 | Numéro `S` | **À la création**, compteur partagé avec les réponses. Trou assumé si brouillon supprimé. |
| Q6 | Exemplaire posté | **Conservé, en HTML** (pas de PDF ni de nouvelle dépendance pour l'instant). |
| Q7 | Workflow sans étape d'envoi, en courriel | Signalé dès la création ; **clôture `processed` refusée** sans envoi réel. |
| Q8 | Contact ayant refusé `traitement` | Avertissement non bloquant. |
| Q9 | Contact archivé au Socle | Avertissement, proposition de re-sélection. |
| Q10 | Retour arrière après envoi | **Interdit** ; `resetSendMarker` (sans appelant) est supprimé. |
| Q11 | Coquilles existantes | Lecture seule + action « Affecter une organisation ». |
| Q12 | Contexte IA | Entrant explicitement lié autorisé ; **jamais** les notes internes. |
| Q13 | Canal `portal` | Retiré pour les sortants. |
| Q14 | Espace élu mobile | Hors périmètre. |
| — | PJ des réponses existantes | Non : PJ envoyées pour les sortants autonomes seulement. |

## 4. Périmètre

**Dans le périmètre** : création d'un sortant autonome ; organisation émettrice ; destinataire
Socle (création avec adresse) ; mode courriel ou courrier ; rédaction manuelle, IA, « Améliorer » ;
workflow réponse de l'organisation émettrice ; envoi SMTP ; postal (lettre + « posté » daté +
exemplaire HTML) ; pièces jointes ; lien facultatif vers un entrant ; historique sur le sortant.

**Hors périmètre** : publipostage, lettre recommandée électronique ou envoi La Poste dématérialisé,
signature qualifiée, suivi de distribution du courriel, création depuis l'espace élu mobile,
reprise automatique des coquilles, PDF.

## 5. Droits

| Action | admin | gestionnaire | élu | superviseur | consultant |
|---|:-:|:-:|:-:|:-:|:-:|
| Voir les sortants de son périmètre | ✅ | ✅ | ✅ | ✅ | ✅ |
| Créer, rédiger, IA, transitions, envoyer, marquer posté | ✅ | ✅ | ✅ | ✅ | ❌ |
| Créer un contact au Socle | ✅ | ✅ | ✅ | ✅ | ❌ |
| Viser | `is_viseur` + rattaché à l'organisation émettrice | | | | ❌ |
| Signer | signataire lié à l'organisation émettrice + image de signature | | | | ❌ |
| Configurer le workflow réponse | ✅ | ❌ | ❌ | ❌ | ❌ |

## 6. Parcours

**Courriel (nominal)** : Nouveau courrier → organisation émettrice (préremplie s'il n'y en a qu'une ;
celles sans workflow réponse sont grisées avec leur nom) → destinataire → mode (défaut :
`preferred_channel`, sinon courriel si email, sinon courrier) → objet → création (numéro `S`, état
initial du workflow réponse, participant `recipient` avec `socle_contact_id`) → rédaction, assistant
→ visa, signature selon le workflow → étape d'envoi : le courriel part, `sent_at` réel → clôture.

**Courrier postal** : adresse exigée (ligne 1, code postal, ville) au plus tard à l'impression
finale ; à l'étape d'envoi, « Imprimer et marquer posté » avec une date (ni future, ni antérieure à
la création) qui devient `sent_at` ; l'exemplaire HTML est rattaché au courrier.

**Contact sans la coordonnée requise** : signalé ; on complète la fiche au Socle sans quitter
l'écran, ou on change de mode.

**Pièces jointes** : ajoutées au sortant ; envoyées avec le courriel ; listées « P.J. » sur la lettre.

**Lien vers un entrant** : par `courier_relations` (`sujet_lie`), jamais par `parent_courier_id`.

## 7. Règles métier

- **R1** Sortant autonome = `direction = 'outbound'` et `parent_courier_id IS NULL`.
- **R2** Même compteur `S` que les réponses, consommé à l'INSERT.
- **R3** Organisation émettrice = `couriers.socle_organization_id`, obligatoire, du tenant, active,
  dans le périmètre de l'utilisateur.
- **R4** Workflow = `reply_workflow_id` de l'organisation émettrice ; absent → création refusée.
- **R5** Création dans l'état `is_initial` de ce workflow.
- **R6** Changement d'organisation seulement à l'état initial, ni visé, ni signé, ni envoyé ; retour
  à l'état initial du nouveau workflow, signataire vidé.
- **R7** Exactement un `recipient` lié par `socle_contact_id` ; nom, email et adresse en instantané,
  rafraîchi tant que rien n'est signé ni parti.
- **R8** `channel` ∈ {`email`, `paper`} ; modifiable jusqu'au visa ou à la signature.
- **R9** IA uniquement via `_shared/socleAi.ts` ; contexte : consigne, organisation émettrice,
  destinataire, objet, mode, brouillon, entrant lié ; jamais les notes internes ; consigne de
  2 000 caractères au plus ; confirmation avant d'écraser un corps non vide.
- **R10** Visa et signature : mêmes règles que les réponses ; contenu figé après signature.
- **R11** Courriel : à l'étape `is_send`, SMTP du miroir Socle, jamais deux fois, PJ incluses,
  `sent_at` = date réelle.
- **R12** Postal : « posté » explicite et daté → `sent_at` ; exemplaire HTML conservé.
- **R13** Historique sur le sortant (création, changements de destinataire, de mode ou
  d'organisation, IA, états, visa, signature, retrait, envoi, posté, échec) ; miroir sur l'entrant lié.
- **R14** Aucun consentement exigé ; `consents = []` ; avertissement si `traitement` refusé.
- **R15** Tout objet référencé est résolu dans le tenant du courrier ; refus serveur sinon.
- **R16** Liste : colonne Type (Réponse / Initiative), destinataire, état ; « Envoyé le » vide tant
  que rien n'est parti ; tableau de bord et parapheur incluent les sortants autonomes.

## 8. Cas limites

| Cas | Comportement |
|---|---|
| Courriel sans email | Option grisée avec motif ; envoi bloqué. |
| Courrier sans adresse | « Marquer posté » bloqué, lien pour compléter la fiche. |
| Organisation sans workflow réponse | Création refusée (UI et serveur), message nommant l'organisation. |
| Workflow sans étape d'envoi (courriel) | Signalé ; clôture `processed` refusée sans envoi. |
| Pas de SMTP / échec SMTP | Rien ne part, le courrier reste à l'état d'envoi, événement d'échec, relance possible. |
| Double clic sur Envoyer | Un seul message (réservation atomique, 409). |
| Socle indisponible | Recherche et création de contact impossibles ; un sortant existant reste ouvrable ; civilité « Madame, Monsieur ». |
| IA indisponible ou crédit épuisé | Message du guichet relayé ; corps intact. |
| Contact archivé | Avertissement avant envoi. |
| Organisation devenue obsolète | Les sortants engagés se terminent ; plus de création. |
| Après signature | Tout verrouillé, sauf retrait de signature tracé. |
| Après envoi | Lecture seule, pas de renvoi. |
| Annulation avant envoi | Corbeille (`trash_courier`) ; numéro `S` perdu. |
| Consultant / autre tenant | Refus côté serveur. |

## 9. Critères d'acceptation

1. **CA1** Création nominale : `outbound`, parent NULL, `socle_organization_id`, état initial du workflow réponse, numéro `S`, un `recipient` avec `socle_contact_id`.
2. **CA2** Numéro `S` partagé avec les réponses ; compteur `E` inchangé.
3. **CA3** Organisation sans workflow réponse : refus par l'UI et par appel direct.
4. **CA4** Seules les organisations du périmètre sont proposées.
5. **CA5** Consultant : pas de bouton, INSERT direct refusé.
6. **CA6** Création d'un contact avec adresse au Socle, sélectionné, lié au participant.
7. **CA7** Doublon proposé avant création.
8. **CA8** Courriel impossible sans email (désactivé, envoi refusé sans changement d'état).
9. **CA9** « Posté » bloqué sans code postal.
10. **CA10** IA nominale via le guichet du Socle, avec la référence du courrier.
11. **CA11** Confirmation avant d'écraser, annulable.
12. **CA12** IA indisponible : message du guichet, corps intact.
13. **CA13** Aucun appel direct à un fournisseur (`src/test/socle/socle-ai.test.ts`).
14. **CA14** Visa requis pour franchir l'étape, accordé par un viseur rattaché.
15. **CA15** Signature réservée au signataire lié, côté serveur ; corps figé ensuite.
16. **CA16** Courriel envoyé une fois, avec PJ ; `sent_at` réel ; événement sur le sortant.
17. **CA17** Pas de SMTP : rien ne part, pas de marqueur, événement d'échec.
18. **CA18** Second envoi : 409, aucun second message.
19. **CA19** Postal : `sent_at` = date posté, exemplaire rattaché, date future refusée.
20. **CA20** Historique du sortant complet.
21. **CA21** Parapheur et espace élu voient et signent les sortants autonomes.
22. **CA22** Liste avec type, destinataire, état, « Envoyé le » seulement si parti.
23. **CA23** Lien vers un entrant visible des deux côtés, absent de l'onglet Réponse.
24. **CA24** Avertissement si `traitement` refusé ; `consents = []`.
25. **CA25** Organisation ou workflow d'un autre tenant refusé.

## 10. Architecture

### ADR-1 — Moteur de rédaction partagé

`ReplyComposer` (~1 500 lignes) mêle liste des réponses et éditeur, et code le parent en dur
(liste `:222-226`, création `:439-468`, ancre des événements dans chaque mutation, `canEmail` et
fusions depuis l'expéditeur du parent `:145-146, 885-911`, IA `:913-937`).

- `src/hooks/useOutboundComposer.ts` : état et mutations de l'éditeur, paramétrés par une cible
  `OutboundTarget { organizationId, outboundId, eventCourierId, socleOrganizationId, recipient, ai: { kind: "reply", courierId } | { kind: "initiative", outboundId }, ensure? }`.
- `src/components/courier/outbound/OutboundEditor.tsx` : vue éditeur extraite.
- `ReplyComposer` garde ses props, sa liste et sa création paresseuse, et rend `OutboundEditor`.
- `src/components/courier/outbound/InitiativeComposer.tsx` : organisation, destinataire, mode,
  panneau IA « consigne libre », puis `OutboundEditor`.

Rejeté : un prop `mode` dans `ReplyComposer` ; un second composeur copié.

### ADR-2 — Historique ancré sur `parent ?? self`

- Helper pur `eventCourierIdOf(courier)` dans `src/lib/courier-events.ts`.
- Les événements de cycle (`reply_state_changed`, `reply_signed`, `reply_unsigned`,
  `reply_visa_granted`, `reply_email_sent`) gardent leur nom et `payload.reply_id`.
- Nouveaux types (texte libre, pas d'enum) : `outbound_created`, `outbound_recipient_changed`,
  `outbound_channel_changed`, `outbound_org_changed`, `outbound_ai_drafted`, `outbound_posted`,
  `reply_email_failed`, `outbound_linked`.
- `lib/courier-history.ts` : libellés « Courrier signé » quand `payload.reply_id === courier_id`.
- Miroir sur l'entrant lié : `outbound_linked`, `reply_email_sent`, `outbound_posted`.

**Bug existant** : `useSignAndAdvance.ts:107,120,167` passe `ctx.parentCourierId!` (NULL sans
parent) ; `logEvent` avale l'échec (`courierEventService.ts:30-44`). Corrigé au lot 0.

### ADR-3 — IA : mode « initiative » dans `draft-reply`

- Aiguillage après le préambule commun (auth, adhésion, `assertEditor`, `isAiConfigured`,
  `socleOrgIdFor`, `index.ts:161-207`) si le corps porte `{ mode: "initiative", outboundId, orgId, prompt, currentSubject }`.
- `draft-reply/initiative.ts` (handler) et `draft-reply/initiativeLogic.ts` (pur, testable Vitest),
  réutilisant `INSTRUCTIONS_CHARS`, `fitMessage`, `splitDraftSubject`, `stripHtml`, `formatDateFr`,
  `socleCivility`.
- `socleCompletion({ agent: AGENT_REDACTION, feature: FEATURE_DRAFT, reference: { kind: "courier", id: outboundId } })`.
- Lit : le sortant (contrôle `outbound`, parent NULL, tenant), le `recipient`, la civilité Socle,
  l'organisation émettrice, le brouillon, les entrants liés. Ne lit jamais `courier_notes`.
- Consigne vide ou > 2 000 caractères → 400. Événement `outbound_ai_drafted` avec `{ prompt_chars }`
  seulement (la consigne n'est pas stockée).
- `improve-reply` : inchangé.

Rejeté : une fonction `draft-outbound` séparée (préambule dupliqué, un déploiement de plus).

### ADR-4 — `sent_at` réel, « posté » dans `metadata`

1. Migration qui assouplit `check_dates` pour `outbound` (définition live au § 12).
2. Le sortant autonome naît avec `sent_at` NULL ; posé par `send-courier-reply`, par « posté », ou en
   dernier recours par `transitionReplyState` au passage en `processed`.
3. `metadata.posted_at`, `posted_by`, `posted_document_id` (pas de colonne).
4. Règles du « posté » tenues par le trigger de l'ADR-6 : mode `paper`, date dans
   `[created_at::date, aujourd'hui]`, immuable une fois posée.
5. `createReply` ne pose plus le leurre : « Envoyé le » reste vide pour une nouvelle réponse tant
   qu'elle n'est pas partie. Les réponses existantes ne sont pas reprises.

### ADR-5 — Pièces jointes dans `send-courier-reply`

- Module pur `_shared/outboundAttachments.ts` :
  `planOutboundAttachments(docs, { maxTotalBytes, maxCount }) → { items, refused }` (10 Mo proposés,
  à caler sur la limite du relais SMTP).
- Sources : `courier_documents` du sortant et du tenant, téléchargés en service_role avec contrôle
  du préfixe de `storage_key` (comme `storage-documents/index.ts:187`).
- Au-delà du plafond : 413 avant SMTP, jamais d'envoi partiel.
- V1 : seulement si `parent_courier_id IS NULL`.

### ADR-6 — Garde serveur : trigger + RPC de création

La RLS laisse un éditeur faire un INSERT direct ; les gardes existantes ne couvrent pas le cas sans
parent et sans workflow réponse.

**Trigger `couriers_enforce_outbound_initiative()`**, `BEFORE INSERT OR UPDATE OF
socle_organization_id, channel, workflow_state_id, metadata`, pour `direction = 'outbound' AND
parent_courier_id IS NULL`, bypass `is_transition_guard_bypassed()`, messages partagés avec
`_shared/outboundInitiativeGuard.ts`.

- INSERT : organisation non NULL, du tenant, non obsolète, `reply_workflow_id` non NULL, état
  initial de ce workflow, `channel IN ('email','paper')`.
- Changement d'organisation : coquille (état NULL) → tenant et activité seulement ; sinon R6.
- Changement de mode : `email`/`paper`, rien de signé ni d'envoyé.
- **Sortants hérités hors workflow réponse** (§ 12) : les règles d'UPDATE ne doivent s'appliquer
  qu'aux lignes dont l'état appartient au workflow réponse de leur organisation, pour ne pas
  bloquer les 555 sortants du jeu de données ACCM.

**RPC `create_outbound_courier(p_organization_id uuid, p_socle_organization_id uuid, p_channel courier_channel, p_subject text, p_recipient jsonb, p_linked_courier_id uuid DEFAULT NULL) RETURNS uuid`**,
SECURITY INVOKER (RLS et triggers de l'appelant), qui crée en une transaction le courrier, le
participant, l'événement et le lien éventuel. Un échec rend le numéro `S`.

Rejeté : RPC seule (INSERT direct ouvert) ; SECURITY DEFINER (contrôles à refaire à la main).

### ADR-7 — Exemplaire posté en HTML

- Extraire `renderLetterHtml(options)` (pur) de `printReply.ts`, avec `mergeContext` (`:208-229`).
- À « Imprimer et marquer posté » : HTML fusionné, signature en `data:`, déposé comme
  `courier_document` (`<numéro> – exemplaire posté.html`), puis `metadata.posted_*`.
- Servi en `iframe sandbox` ou en téléchargement (risque XSS : corps et modèle saisis par des
  utilisateurs).

## 11. Modèle de données, fonctions et écrans

### Migrations

Rejouables (`CREATE OR REPLACE`, `DROP … IF EXISTS`), appliquées par `apply_migration`, jamais
`db push` (voir `docs/deployment.md`).

| Lot | Fichier | Contenu |
|---|---|---|
| 1 | `<ts>_sortants_sent_at_reel.sql` | `check_dates` : `sent_at` peut être NULL pour `outbound`. |
| 1 | `<ts>_sortants_initiative.sql` | `outbound_initiative_block_reason(...)` (STABLE, SECURITY DEFINER, EXECUTE retiré à PUBLIC/anon), trigger, RPC `create_outbound_courier` (GRANT `authenticated`). |
| 2 | `<ts>_sortants_cloture_courriel.sql` | Pas de `processed` en mode courriel sans `metadata.sent_email_at`. |
| 4 | `<ts>_sortants_poste.sql` | Règles de `metadata.posted_at` ; pas de `processed` en mode courrier sans `posted_at`. |

Sans changement : `assign_courier_chrono` (CA2 par construction), `couriers_track_acknowledgement`,
`couriers_track_resolution`, `fn_create_courier_notifications` (entrants seulement), garde de
signature, garde de visa, garde de création des réponses. `courier_relations` réutilise `sujet_lie`.
`courier_participants` : adresse en texte dans `address` et structurée dans `metadata`. Aucune
nouvelle policy. Régénérer `src/integrations/supabase/types.ts` après le lot 1 (relire le diff).

### Edge functions

| Fonction | Changements |
|---|---|
| `draft-reply` | Mode initiative (ADR-3) ; chemin réponse inchangé. |
| `send-courier-reply` | Exiger `direction = 'outbound'` (un entrant de canal email est aujourd'hui « envoyable ») ; réservation atomique `email_send_claimed_at` conditionnée à `sent_email_at IS NULL` ; destinataire autonome = `recipient` avec `socle_contact_id`, repli fiche Socle ; PJ (ADR-5) ; événements de succès et d'échec sur l'ancre, miroir sur l'entrant lié. |
| `socle-contacts`, `improve-reply` | Aucun. |

Pas de nouvelle edge function.

### Services, hooks, écrans

- **Nouveau** `src/services/outboundCourierService.ts` : `createOutboundCourier`,
  `changeOutboundOrganization`, `changeOutboundChannel`, `setOutboundRecipient`,
  `refreshRecipientSnapshot`, `markOutboundPosted`, `linkInbound`.
- **Nouveau** `src/lib/outbound-channel.ts` : `defaultChannel`, `emailBlocker`, `postalBlocker`,
  `addressLines`.
- **Modifiés** : `courierReplyService` (`parentCourierId` → `eventCourierId`, fin du leurre,
  suppression de `resetSendMarker`), `courierVisaService.grantVisa`,
  `replyApprovalService.loadApprovalContext`, `dashboardService.countMyDraftReplies`,
  `courierDraftService.draftOutbound`.
- **Hooks** : `useCourierWorkspace` (`isInitiative`), `useSignAndAdvance`, `useEluSignatureQueue`,
  `useEluVisaQueue` (ancre `parent ?? self`).
- **Écrans** : `NewOutboundDialog` remplace le dialogue coquille de `CourriersSortants.tsx` ;
  colonne Type par enrichissement client (`search_couriers` ne renvoie pas `parent_courier_id`) ;
  `CourierWorkspacePage` branche `isInitiative` (onglet Rédaction, destinataire = `recipient`,
  expéditeur = organisation émettrice, date d'envoi en lecture seule, onglet Liens, coquilles en
  lecture seule avec « Affecter une organisation ») ; `ContactFormDialog` extrait de
  `pages/Contacts.tsx` et ouvert par `ContactPicker` (`createWith="full"`) ; `printReply.ts`
  (`renderLetterHtml`) ; libellés d'historique.
- Pas de nouvelle route : `/courrier/:id`.

## 12. Vérifications en base live (2026-10-13)

| Vérification | Résultat | Conséquence |
|---|---|---|
| `check_dates` | `(inbound AND received_at IS NOT NULL) OR (outbound AND sent_at IS NOT NULL) OR internal` | Lot 1 : remplacer la branche `outbound` par `direction = 'outbound'`. |
| Triggers sur `couriers` | 14, conformes au dépôt (`assign_chrono`, `chrono_immutable`, `consents_*`, `enforce_signature`, `enforce_transition`, `enforce_visa`, `reply_creation_guard`, `supersede_visas`, `track_acknowledgement`, `track_resolution`, notifications, `updated_at`) | Pas de dérive. |
| Policies `couriers`, `courier_participants` | INSERT/UPDATE sous `is_editor_of(organization_id)` ; `service_role_full` | RPC en INVOKER suffisante. |
| Coquilles (sans organisation ni état) | 2 : ACCM (papier), Agglomération Normandie Démo (courriel) | « Affecter une organisation » suffit, pas de migration de données. |
| **Sortants sans parent avec organisation et état** | **555 sur ACCM**, tous `metadata.seed_bulk`, sans numéro, `created_by` NULL, avec un `recipient` sans `socle_contact_id`, dans le **workflow des entrants** (pas le workflow réponse), créés de janvier à juillet 2026 | **Purgés le 2026-10-13** (tenant de démo, accord du PO) ; `02-couriers-clara.sql` ne génère plus de sortants. La précaution de l'ADR-6 reste utile si un tel import réapparaît. |
| Organisations actives sans workflow réponse | ACCM 1/8, Agglomération Normandie Démo 9/12, Test 2 1/1 | Création impossible pour ces organisations tant qu'un administrateur n'a rien configuré. Prévenir avant le lot 1. |
| Workflows réponse sans étape `is_send` | [TEST] Alpha, [TEST] Beta | Le reseed [TEST] doit ajouter une étape d'envoi avant le lot 2, sinon la clôture des courriels y sera refusée. |
| Réponses avec documents | 0 | Activer les PJ pour les réponses plus tard ne pose pas de risque immédiat. |
| Sortants au canal `portal` | 0 | Retrait de `portal` sans reprise. |

## 13. Carte de couplage

| Module | Changement | Risque |
|---|---|---|
| `ReplyComposer.tsx` | Extraction (lot 0) | **Élevé** : recette visa, signature, envoi, impression des réponses. |
| `send-courier-reply/index.ts` | Direction, réservation, PJ, événements | **Élevé** : tout l'envoi courriel. |
| `courierReplyService.ts` | Ancre, fin du leurre `sent_at` | Moyen : « Envoyé le » vide pour les nouvelles réponses. |
| `replyApprovalService.ts`, `useSignAndAdvance.ts` | Sans parent | Moyen : parapheur en lot, espace élu. |
| `CourierWorkspacePage.tsx` | Branche `isInitiative` | Moyen : rester strict pour ne pas toucher les réponses ni les 555 hérités. |
| `draft-reply/index.ts` | Aiguillage en tête | Faible. |
| `useEluSignatureQueue`, `useEluVisaQueue`, `courierVisaService`, `dashboardService` | Ancre | Faible. |
| Gardes transitions, signature, visa, création ; chrono | Aucun | Nul. |
| `scripts/bulk-seed/02-couriers-clara.sql:159` | Insère des sortants sans parent ni organisation | **Cassé par le trigger** : `SET LOCAL clara.bypass_transition_guard = 'on'`. |
| Tests d'intégration `garde-transitions`, `signature-guard`, `visa-guard` | — | À rejouer après le reseed CI. |

## 14. Lots

Ordre de chaque lot : migration → edge function → front. Pousser sur `main` publie en production ;
la CI reseede [TEST] environ 10 minutes après.

| Lot | Contenu | CA | Tests | Déploiement |
|---|---|---|---|---|
| 0 | Moteur partagé, ancre d'événements, corrections parapheur / espace élu / tableau de bord, suppression de `resetSendMarker`. Rien de visible. | préparation de CA21 | `courier-events.test.ts`, `useEluSignatureQueue.test.tsx` étendu, `replyApprovalService.test.ts`, libellés d'historique | push |
| 1 | Création, rédaction manuelle, visa, signature, liste avec Type, coquilles, avertissements, correctif du seed | CA1–7, 14, 15, 20–22, 24, 25 | SQL `supabase/tests/outbound_initiative.test.sql` ; intégration `sortants-initiative.itest.ts` ; `outbound-channel.test.ts`, `outboundCourierService.test.ts` | SQL → push, **sans délai** (l'ancien dialogue est refusé entre les deux) |
| 2 | Envoi courriel avec PJ, clôture sans envoi refusée | CA8, 16–18 | `outbound-attachments.test.ts` ; SQL ; recette sur le seul tenant [TEST] avec SMTP | SQL → `functions deploy send-courier-reply` → push |
| 3 | Assistant par consigne, « Améliorer » | CA10–13 | `draft-reply-initiative.test.ts` ; `socle-ai.test.ts` | `functions deploy draft-reply` → push |
| 4 | Envoi postal, exemplaire HTML | CA9, 19 | `render-letter.test.ts` ; SQL (date future, antérieure, mode courriel, second `posted_at`, clôture sans `posted_at`) | SQL → push |
| 5 | Lien avec un entrant, miroir d'événements | CA23 | `courierRelationService` + miroir | push |

À chaque lot, mettre à jour `docs/deployment.md`, et en fin de chantier `features.md:8`,
`data-model.md` (sens de `sent_at`, clés `posted_*` et `email_send_claimed_at`),
`edge-functions.md`, `garde-transitions-workflow.md` § 8.

## 15. Risques et sécurité

- RPC en INVOKER ; le trigger vérifie le tenant de l'organisation (CA25).
- `socle_contact_id` non vérifiable en SQL : effet borné (la clé Socle du tenant ne lit pas la fiche
  d'un autre tenant, l'envoi exige un email).
- PJ : documents de ce sortant et de ce tenant uniquement, préfixe contrôlé, plafond.
- Exemplaire HTML : `iframe sandbox` ou téléchargement.
- Règle d'or n° 7 : tout passe par `socleCompletion`. Règle d'or n° 8 : `consents` ni écrit ni lu.
- Existant hors périmètre : `send-courier-reply:190` porte `rejectUnauthorized: false`.
- Un brouillon d'agent non « service courrier » ne peut pas être restauré depuis la corbeille
  (`trash_courier` / restauration sous `can_access_mailroom`).
- Prévenir les administrateurs : organisations sans workflow réponse, workflows sans étape d'envoi.
