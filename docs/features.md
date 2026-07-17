# Fonctionnalités

## 1. Saisie & réception des courriers

### Saisie manuelle
- Dialogue `NewCourierDialog.tsx` : direction, canal, sujet, expéditeur/destinataire (via `ContactPicker`, branché sur le référentiel de contacts du Socle), pièces jointes.
- Création via `courierService.createCourier` → numérotation automatique (`courier_sequences` annuel par direction).

### Réception automatique IMAP
- Edge function `fetch-inbound-emails` : poll des boîtes IMAP configurées par org (et optionnellement par service via `org_services`).
- Crée un `courier` `direction=inbound`, importe les pièces jointes dans le bucket `clara-documents`, crée les participants.
- Déclenchée manuellement (bouton) ou par planification (à câbler côté cron si besoin).
- Config UI : `src/components/ImapSettings.tsx`.

## 2. Analyse IA d'un courrier

Pipeline en deux étapes, déclenché depuis `CourierDetail` ou `SuggestedActionsCard` :

1. **OCR** — edge function `analyze-courier?action=ocr-courier` :
   - Pour chaque `courier_document`, extrait le texte (PDF → texte, images → OCR via le modèle Gemini multimodal).
   - Écrit dans `courier_document_extracts` (cache).
2. **Analyse LLM** — edge function `analyze-courier?action=analyze` :
   - Lit les extraits + corps du courrier, appelle Lovable AI Gateway.
   - Produit `summary`, `intents[]`, `sentiment`, `suggested_actions[]` → `courier_analyses`.

Service client : `src/services/courierAnalysisService.ts`.

### Rédaction de réponse IA
- Edge function `draft-reply` : prend `courier_id`, `response_type`, instructions additionnelles → renvoie du HTML prêt à coller dans l'éditeur Tiptap.
- UI : `ReplyComposer.tsx`.

## 3. Workflows

- Configurables par org dans `Workflows.tsx` / `WorkflowDetail.tsx` (éditeur visuel React Flow, `@xyflow/react`).
- Deux types (`kind`) : workflow principal des courriers, et workflow des réponses.
- Chaque `workflow_state` a une `category` : `draft`, `in_progress`, `processed`, `archived` — détermine l'onglet d'affichage (`CourriersEnInstruction`, `CourriersTraites`, `CourriersArchives`).
- Transitions définies par `workflow_transitions`. La validité des transitions est vérifiée côté client (et idéalement par trigger DB pour les cas critiques).

## 4. Réponses (couriers sortants)

- Modèle : un courrier `direction=outbound` avec `parent_courier_id` pointant l'inbound.
- Service : `src/services/courierReplyService.ts` — création, édition, signature, transitions, envoi.
- **Signature** : sélection d'un `signatory` → l'image de signature est intégrée dans le HTML avec un marker `<img alt="signature-clara">`. `stripSignatureBlock()` permet de retirer le bloc avant ré-édition.
- **Envoi SMTP** : edge function `send-courier-reply` envoie via la config SMTP de l'org. Marque `metadata.sent_email_at`. Déclenchée par une transition vers un état de catégorie `processed`.

## 5. Référentiels

### Contacts (`Contacts.tsx`, route `/contacts`)
- **Référentiel servi par le Socle** (source de vérité — plus aucun stockage local d'identité). Liste/recherche (nom, email exact), fiche, création/édition, archivage/restauration via l'edge function `socle-contacts` (proxy de `contacts-api`), service client unique `socleContactService.ts`.
- La fiche affiche aussi les **courriers liés** (donnée Clara : `courier_participants.socle_contact_id`) et les **relations entre contacts** (« est Gérant de… » / « … est Gérant de ce contact »), éditables via le référentiel ; ces relations apparaissent aussi sur les participants d'un courrier et sous l'expéditeur dans le panneau courrier.
- Rapprochement automatique de l'expéditeur par email au passage en instruction (best-effort, jamais bloquant) ; pas d'auto-création (le Socle exige la civilité pour une personne).

### Détection de doublons à la saisie

Toute surface qui peut créer une identité propose d'abord les fiches existantes qui ressemblent à la saisie : formulaire contact (`Contacts.tsx`), création rapide du `ContactPicker`, et ajout/édition d'un participant (`ParticipantManager`). Composant unique : `components/contacts/DuplicateContactsAlert.tsx`.

- **Motifs** (`lib/contact-duplicates.ts`, logique pure) : même email, même téléphone (formats normalisés — `+33 6…`, `06…` et `0033…` se rejoignent), même SIRET, nom+prénom identiques, nom très proche (distance d'édition ≥ 0,82). Une **date de naissance identique ne suffit jamais** : elle ne fait que renforcer un autre motif. Un homonyme de nom de famille seul n'est pas proposé.
- **Sélectionner une fiche** l'associe (participant : `socle_contact_id`) ou l'ouvre (page Contacts) au lieu d'en créer une nouvelle.
- **Best-effort** : référentiel injoignable → aucune alerte, la saisie continue. La détection assiste, elle ne bloque jamais.

**Angles morts assumés**, imposés par l'API contacts du Socle (`list` ne filtre que sur `search` = ilike sur `display_name`, et `email` = égalité exacte ; ni filtre téléphone, ni recherche floue côté serveur). Les candidats sont donc ramenés par email exact + préfixe du nom (4 car.) + prénom, puis rapprochés côté client :
- un doublon au **téléphone seul**, sans email ni nom rapprochable, n'est pas détecté ;
- une **faute sur les premières lettres du nom** *et* sur le prénom échappe aux deux filets ;
- un **accent divergent** dans le nom (`Dupônt` vs `Dupont`) échappe au ilike, qui est sensible aux accents.

Lever ces angles morts suppose un point d'entrée de rapprochement côté Socle (filtre téléphone, ou `pg_trgm` sur les noms) — cf. `docs/technical-debt.md`.

### Signataires (`SignaturesSettings.tsx`)
- Table `signatories` + bucket `signatures`. Chaque signataire a une image PNG transparente utilisée dans les réponses.

### Modèles (`ModeleSettings.tsx`)
- Templates Handlebars stockés dans `templates`. Variables disponibles : `{{usager.nom}}`, `{{courier.sujet}}`, etc. Éditeur Tiptap.

### Services internes (`ServicesSettings.tsx`)
- Table `org_services`. Permet l'assignation `couriers.assigned_service` et la config IMAP par service.

## 6. Démarches & sync Arpège

- Table `procedures` (multi-tenant, RLS x-org-id, écriture admin).
- Champs : `name`, `description`, `icon`, `color`, `external_reference_id`, `external_source` (`arpege`), `is_displayed`, `display_order`.
- Index unique partiel `(organization_id, external_source, external_reference_id)` pour upsert.
- UI CRUD : `ProceduresSettings.tsx`. Badge "Arpège" sur démarches importées.
- **Sync** : edge function `sync-arpege-services` (upsert depuis l'API Arpège). Auth : JWT service role, ou admin user, ou header `x-cron-secret`.
- **Cron nocturne** : pg_cron `sync-arpege-procedures-nightly` à `0 2 * * *` UTC. Fonction SQL `trigger_arpege_sync()` lit `cron_secret` depuis `vault.decrypted_secrets` et POST l'edge function.
- Setup : `SELECT vault.create_secret('<valeur>', 'cron_secret');` avec la même valeur que la variable d'env `CRON_SECRET`.
- Edge functions liées : `sync-arpege-appointments`, `test-arpege-connection`.

## 7. Notifications

- Table `notifications` + cloche `NotificationBell.tsx` + hook `useNotifications`.
- Types : nouveau courrier reçu, réponse envoyée, ticket créé, etc.

## 8. Tags & recherche

- Tags libres par org (`tags` + `courier_tags`). Couleurs gérées via `src/lib/tag-color.ts`.
- Recherche côté pages courriers : ILIKE sur `subject` (cf `courierService.getCouriers`). Pour fulltext avancé, ajouter une colonne `tsvector` + index GIN (non fait à ce jour).

## 9. Super-admin

- Layout dédié `/superadmin/*` (`SuperAdminLayout`, `SuperAdminSidebar`).
- Gestion des organisations, création initiale, vue cross-org.
- Accès gardé par `isSuperAdmin(profile)` côté client **+** RLS server-side (les helpers `is_superadmin()` bypassent les filtres org).
