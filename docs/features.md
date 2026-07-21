# Fonctionnalités

> Dernière vérification : 2026-07-21 pour les sections routes, référentiels, services/Socle et frontière actions Clara/partenaires.

## 1. Saisie & réception des courriers

### Saisie manuelle
- Dialogue `NewCourierDialog.tsx` : direction, canal, sujet, expéditeur/destinataire (via `ContactPicker`, branché sur le référentiel de contacts du Socle), pièces jointes.
- Création via `courierService.createCourier` → numérotation automatique (`courier_sequences` annuel par direction).

### Réception automatique IMAP
- Edge function `fetch-inbound-emails` : poll des boîtes IMAP configurées par tenant ou par organisation Socle (`imap_settings.socle_organization_id`). Le fallback vers les anciens services est legacy et ne doit pas servir de base à de nouveaux développements.
- Crée un `courier` `direction=inbound`, importe les pièces jointes dans le bucket `clara-documents`, crée les participants.
- Déclenchée manuellement (bouton) ou par planification (à câbler côté cron si besoin).
- Config UI : `src/components/ImapSettings.tsx`.
- Plafond de 15 Mo par email (surchargeable par boîte). Au-delà de 2 Mo, le courrier porte `metadata.is_large_email` et s'affiche avec une icône « volumineux » dans la Boîte aux lettres.

### Numérisation (copieur réseau)
- **Pas d'accès matériel depuis le navigateur** : ni WebUSB, ni eSCL (pas de CORS côté scanner), et un agent local sur `localhost` se heurte au verrouillage réseau de Chrome (Local Network Access) et à l'interdiction de Safari. Le pont retenu est donc le **dépôt automatique**.
- Le copieur est configuré en « scan vers email » sur une boîte dédiée, marquée **boîte de numérisation** (`imap_settings.is_scan_inbox`). Fonctionne avec tout scanner déjà installé, sans logiciel sur les postes ni licence.
- Ingestion en mode scan : canal `paper`, pas de participant `sender` (l'adresse du copieur va dans `metadata.scan_device_email`), sujet neutre remplacé ensuite par `suggested_subject`, allowlist `scan_allowed_senders` — **sans elle, quiconque connaît l'adresse crée des courriers**.
- L'OCR et l'analyse sont enfilés automatiquement (voir §2), puis l'agent qualifie le courrier depuis la Boîte aux lettres.
- Réglages copieur recommandés : PDF (pas TIFF, non géré par l'OCR), 200–300 dpi, niveaux de gris, « un fichier par document » pour éviter d'avoir à découper les lots.

### Import en masse
- Page `BulkImport.tsx` (`/import-en-masse`), wizard 5 étapes : canal → documents → association → vérification → confirmation. Regroupement de fichiers par `groupId` (un courrier = N fichiers). Formats : PDF, JPG, PNG.

## 2. Analyse IA d'un courrier

Pipeline en deux étapes, déclenché depuis `CourierDetail` ou `SuggestedActionsCard` :

1. **OCR** — edge function `analyze-courier?action=ocr-courier` :
   - Pour chaque `courier_document`, extrait le texte (PDF → texte, images → OCR via le modèle Gemini multimodal).
   - Écrit dans `courier_document_extracts` (cache).
2. **Analyse LLM** — edge function `analyze-courier?action=analyze` :
   - Lit les extraits + corps du courrier, appelle Lovable AI Gateway.
   - Produit `summary`, `intents[]`, `sentiment`, `suggested_actions[]` → `courier_analyses`.

Service client : `src/services/courierAnalysisService.ts`.

### Déclenchement automatique (file d'attente)
Les chemins d'**ingestion** ne peuvent pas océriser en ligne : c'est long, coûteux en quota, et une erreur ferait perdre tout un lot. Ils enfilent donc un job dans `courier_analysis_jobs`, consommé par l'edge function `process-analysis-queue` (cron 2 min).

- Producteurs : `fetch-inbound-emails` (insert direct, service role) et `BulkImport` (RPC `enqueue_courier_analysis` via `src/services/courierAnalysisJobService.ts`).
- Un seul job vivant par courrier (index unique partiel) : recliquer ou réimporter n'empile pas d'OCR concurrents.
- Quota IA épuisé → job reporté au mois suivant **sans consommer de tentative**. Autres erreurs → 3 tentatives espacées de 5 min.
- Indispensable à la numérisation : personne n'est devant l'écran pour cliquer « Analyser ».

Les suggestions (`suggested_subject`, `suggested_sender`, `suggested_service_name`) sont exposées sur un courrier existant dans l'onglet « Contenu » (`ContentIntentsTab`), le titre étant applicable en un clic — c'est ce qui permet de qualifier un courrier numérisé arrivé sans titre exploitable.

### Rédaction de réponse IA
- Edge function `draft-reply` : prend `courier_id`, `response_type`, instructions additionnelles → renvoie du HTML prêt à coller dans l'éditeur Tiptap.
- UI : `ReplyComposer.tsx`.

## 3. Workflows

- Configurables par org dans `Workflows.tsx` / `WorkflowDetail.tsx` (éditeur visuel React Flow, `@xyflow/react`).
- Deux types (`kind`) : workflow principal des courriers, et workflow des réponses.
- Chaque `workflow_state` a une `category` : `draft`, `in_progress`, `processed`, `archived` — détermine l'onglet d'affichage (`CourriersEnInstruction`, `CourriersTraites`, `CourriersArchives`).
- Transitions définies par `workflow_transitions`. La validité des transitions est vérifiée côté client (et idéalement par trigger DB pour les cas critiques).

## 4. Actions issues d'un courrier

Clara ne remplace pas les applications métier qui exécutent les demandes d'action. Elle sert de point de suivi côté courrier :

- actions internes minimales : demander à un collègue de faire quelque chose, notifier, suivre un état simple ;
- actions externes : créer ou référencer une demande dans Iris ou une application partenaire (Arpège aujourd'hui, autres connecteurs possibles), puis conserver le lien et l'état de résolution utiles à la réponse ;
- l'analyse IA peut recommander des actions, mais l'agent reste responsable de la décision et du circuit retenu.

## 5. Réponses (couriers sortants)

- Modèle : un courrier `direction=outbound` avec `parent_courier_id` pointant l'inbound.
- Service : `src/services/courierReplyService.ts` — création, édition, signature, transitions, envoi.
- **Signature** : sélection d'un `signatory` → l'image de signature est intégrée dans le HTML avec un marker `<img alt="signature-clara">`. `stripSignatureBlock()` permet de retirer le bloc avant ré-édition.
- **Envoi SMTP** : edge function `send-courier-reply` envoie via la config SMTP de l'org. Marque `metadata.sent_email_at`. Déclenchée par une transition vers un état de catégorie `processed`.

## 6. Référentiels

### Contacts (`Contacts.tsx`, route `/contacts`)
- **Référentiel servi par le Socle** (source de vérité — plus aucun stockage local d'identité). Liste/recherche (nom, email exact), fiche, création/édition, archivage/restauration via l'edge function `socle-contacts` (proxy de `contacts-api`), service client unique `socleContactService.ts`.
- La fiche affiche aussi les **courriers liés** (donnée Clara : `courier_participants.socle_contact_id`) et les **relations entre contacts** (« est Gérant de… » / « … est Gérant de ce contact »), éditables via le référentiel ; ces relations apparaissent aussi sur les participants d'un courrier et sous l'expéditeur dans le panneau courrier.
- Rapprochement automatique de l'expéditeur par email au passage en instruction (best-effort, jamais bloquant) ; pas d'auto-création (le Socle exige la civilité pour une personne).
- **L'expéditeur du panneau courrier est un sélecteur d'usager** (`ContactPicker`, plus de saisie libre du nom dans la colonne latérale) : sélectionner une fiche renseigne `socle_contact_id` et aligne nom/email/téléphone/adresse du participant sur le référentiel ; « Aucun contact » dissocie sans effacer ce que porte le courrier.

### Détection de doublons à la saisie

Toute surface qui peut créer une identité propose d'abord les fiches existantes qui ressemblent à la saisie : formulaire contact (`Contacts.tsx`), création rapide du `ContactPicker`, et ajout/édition d'un participant (`ParticipantManager`). Composant unique : `components/contacts/DuplicateContactsAlert.tsx`.

**Le rapprochement appartient au Socle** (`POST /v1/contacts/match`, action `match` du proxy `socle-contacts`) : Clara décrit l'identité saisie, le Socle renvoie les fiches ressemblantes déjà classées avec leurs motifs. Aucun moteur de comparaison côté Clara — `lib/contact-duplicates.ts` ne fait plus que construire le payload (whitelist stricte : une clé inconnue vaut un 400) et garder la saisie trop maigre hors du réseau.

- **Motifs** (vocabulaire du contrat) : `email` (exact, insensible à la casse), `phone` (chiffres significatifs — `+33 6…`, `06…` et `0033…` se rejoignent, comparé au mobile **et** au fixe), `siret`, `name_exact` (après unaccent — `Dupônt` = `Dupont`), `name_similar` (trigram ≥ 0,5 avec garde-fou sur le prénom, donc « Marie Dupont » n'est pas proposée pour « Jean Dupont »), `birth_date` (**jamais suffisant seul** : renfort de score).
- **Score** : classement **au sein d'une même réponse uniquement**, jamais un seuil absolu — le barème appartient au Socle et peut évoluer.
- **Au moins un critère** est requis (email, téléphone, SIRET, nom, raison sociale ou date de naissance) : un **prénom seul ne rapproche rien**. `hasDuplicateSignal` miroite cette règle pour ne pas partir en 400.
- **Sélectionner une fiche** l'associe (participant : `socle_contact_id`) ou l'ouvre (page Contacts) au lieu d'en créer une nouvelle.
- **Best-effort** : référentiel injoignable → aucune alerte, la saisie continue. La détection assiste, elle ne bloque jamais.

Les angles morts de l'ancienne détection côté client (doublon au **téléphone seul**, faute sur les **premières lettres du nom**, **accent divergent**) sont levés depuis que le rapprochement est fait en SQL (`pg_trgm` + `unaccent`) — 2026-07-17.

### Signataires (`SignaturesSettings.tsx`)
- Table `signatories` + bucket `signatures`. Chaque signataire a une image PNG transparente utilisée dans les réponses.

### Modèles (`ModeleSettings.tsx`)
- Templates Handlebars stockés dans `templates`. Variables disponibles : `{{usager.nom}}`, `{{courier.sujet}}`, etc. Éditeur Tiptap.

### Organisations Socle et anciens services
- La hiérarchie d'assignation active est celle des **organisations Socle**, exposée dans `SocleOrganizationTree` et configurée depuis les sections « Organisations » de `SettingsPage` / `OrgSettings`.
- Les courriers portent `couriers.socle_organization_id` pour la logique métier ; `couriers.assigned_service` reste une dénormalisation d'affichage.
- Les tables legacy `services`, `service_members` et `service_signatories` sont gelées : elles ne doivent plus recevoir de nouveau flux d'écriture, hors fallback documenté dans `docs/data-model.md`.

## 7. Démarches & sync Arpège

- Table `procedures` (multi-tenant, RLS via `is_member_of` / `is_admin_of`, écriture admin).
- Champs : `name`, `description`, `icon`, `color`, `external_reference_id`, `external_source` (`arpege`), `is_displayed`, `display_order`.
- Index unique partiel `(organization_id, external_source, external_reference_id)` pour upsert.
- UI CRUD : `ProceduresSettings.tsx`. Badge "Arpège" sur démarches importées.
- **Sync** : edge function `sync-arpege-services` (upsert depuis l'API Arpège). Auth : JWT service role, ou admin user, ou header `x-cron-secret`.
- **Cron nocturne** : pg_cron `sync-arpege-procedures-nightly` à `0 2 * * *` UTC. Fonction SQL `trigger_arpege_sync()` lit `cron_secret` depuis `vault.decrypted_secrets` et POST l'edge function.
- Setup : `SELECT vault.create_secret('<valeur>', 'cron_secret');` avec la même valeur que la variable d'env `CRON_SECRET`.
- Edge functions liées : `sync-arpege-appointments`, `test-arpege-connection`.

## 8. Notifications

- Table `notifications` + cloche `NotificationBell.tsx` + hook `useNotifications`.
- Types : nouveau courrier reçu, réponse envoyée, ticket créé, etc.

## 9. Tags & recherche

- Tags libres par org (`tags` + `courier_tags`). Couleurs gérées via `src/lib/tag-color.ts`.
- Recherche côté pages courriers : ILIKE sur `subject` (cf `courierService.getCouriers`). Pour fulltext avancé, ajouter une colonne `tsvector` + index GIN (non fait à ce jour).

## 10. Super-admin

- Layout dédié `/superadmin/*` (`SuperAdminLayout`, `SuperAdminSidebar`).
- Gestion des organisations, création initiale, vue cross-org.
- Accès gardé par `isSuperAdmin(profile)` côté client **+** RLS server-side (les helpers `is_superadmin()` bypassent les filtres org).
