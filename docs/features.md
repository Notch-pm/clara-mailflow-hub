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
- Ingestion en mode scan : canal `paper`, pas de participant `sender` (l'adresse du copieur va dans `metadata.scan_device_email`), sujet neutre remplacé ensuite par `suggested_subject`, allowlist `scan_allowed_senders` **fail-closed** : `NULL` ou vide → la boîte n'accepte **rien** (elle n'attend que ses copieurs). Logique testable : `fetch-inbound-emails/logic.ts` (`isInboundSenderAccepted`).
- L'OCR et l'analyse sont enfilés automatiquement (voir §2), puis l'agent qualifie le courrier depuis la Boîte aux lettres.
- Réglages copieur recommandés : PDF (pas TIFF, non géré par l'OCR), 200–300 dpi, niveaux de gris, « un fichier par document » pour limiter la découpe des lots — qui reste possible manuellement à l'import (voir Import en masse).

### Import en masse
- Page `BulkImport.tsx` (`/import-en-masse`), wizard 5 étapes : canal → documents → association → vérification → confirmation. Regroupement de fichiers par `groupId` (un courrier = N fichiers). Formats : PDF, JPG, PNG.
- **Dé-lotissement d'un PDF multi-pages** (lot scanné) : `BulkPdfSplitDialog` découpe à l'écran un PDF en plusieurs courriers — vignettes rendues via `pdfjs`, sélection de pages (clic / shift-clic) puis « Grouper en courrier », le reste des pages restant non associé. Génération client-side (`src/lib/pdf/split.ts`, `pdf-lib`). Découpe **manuelle** ; l'auto-suggestion des points de coupe reste un « à terme » (cf. `docs/technical-debt.md` P1.5).

## 2. Analyse IA d'un courrier

Pipeline en deux étapes, déclenché depuis `CourierDetail` ou `SuggestedActionsCard` :

1. **OCR** — edge function `analyze-courier?action=ocr-courier` :
   - Pour chaque `courier_document`, extrait le texte. **L'ordre des branches est une décision de coût** : texte brut, DOCX, ODT, RTF et PDF à couche texte sont extraits localement, sans IA et **sans toucher au crédit**. Seuls les PDF scannés et les images partent au guichet du Socle (`POST /v1/ocr`).
   - Le document ne quitte pas Clara sous forme d'octets : le guichet reçoit une **URL signée courte** que le fournisseur va chercher lui-même.
   - Écrit dans `courier_document_extracts` (cache) — `model = "socle:ai-api"`, Clara ne connaissant plus le modèle réel.
2. **Analyse LLM** — edge function `analyze-courier?action=analyze` :
   - Lit les extraits + corps du courrier, appelle le **guichet du Socle** (`POST /v1/completions`, alias d'agent `extraction-courrier`).
   - Produit `summary`, `intents[]`, `sentiment`, `suggested_actions[]` → `courier_analyses`.
   - ⚠️ **`tokens_used` est désormais NULL** : le décompte vit dans le journal du Socle, avec la ventilation par application. Y recopier un nombre approché rouvrirait un second compteur, et un chiffre faux est pire qu'un chiffre absent — on ne se méfie pas d'un tableau qui s'affiche.

Service client : `src/services/courierAnalysisService.ts`.

### Déclenchement automatique (file d'attente)
Les chemins d'**ingestion** ne peuvent pas océriser en ligne : c'est long, coûteux en quota, et une erreur ferait perdre tout un lot. Ils enfilent donc un job dans `courier_analysis_jobs`, consommé par l'edge function `process-analysis-queue` (cron 2 min).

- Producteurs : `fetch-inbound-emails` (insert direct, service role) et `BulkImport` (RPC `enqueue_courier_analysis` via `src/services/courierAnalysisJobService.ts`).
- Un seul job vivant par courrier (index unique partiel) : recliquer ou réimporter n'empile pas d'OCR concurrents.
- Crédit IA épuisé → job reporté **à la date de renouvellement rendue par le Socle**, sans consommer de tentative. ⚠️ Depuis le 2026-08-29 le guichet renvoie **deux refus distincts en 429** : le plafond (rien à tenter avant le mois prochain) et la **cadence** (`ai_rate_limited` — le crédit est intact, replanification à 5 min). Les confondre endormirait un mois durant un courrier simplement arrivé dans une rafale. Autres erreurs → 3 tentatives espacées de 5 min.
- Indispensable à la numérisation : personne n'est devant l'écran pour cliquer « Analyser ».

Les suggestions (`suggested_subject`, `suggested_sender`, `suggested_service_name`) sont exposées sur un courrier existant dans l'onglet « Contenu » (`ContentIntentsTab`), le titre étant applicable en un clic — c'est ce qui permet de qualifier un courrier numérisé arrivé sans titre exploitable.

### Rédaction de réponse IA
- Edge function `draft-reply` : prend `courier_id`, `response_type`, instructions additionnelles → renvoie du HTML prêt à coller dans l'éditeur Tiptap.
- UI : `ReplyComposer.tsx`.

### Consommation IA — d'où vient le crédit
Depuis le **2026-08-29**, Clara n'appelle plus de fournisseur LLM : elle compose ses prompts et les
confie au **guichet IA du Socle** (`ai-api`), qui détient la clé, réserve, appelle et solde. Trois
conséquences visibles :

- **Le crédit est celui de la COLLECTIVITÉ**, commun à Clara, Iris et Ariane — plus un cadran par
  produit. L'écran Paramètres › Consommation IA (`AiUsageSettings`) est en **lecture seule** et
  affiche la ventilation par application, un total que Clara seule ne pouvait pas produire. Le
  plafond se règle dans le Socle.
- **Clara ne compte plus rien** : les tables `ai_usage_quotas` / `ai_usage_counters` /
  `ai_usage_events` ont été supprimées (`20260829140000_retrait_plafond_ia.sql`). Les laisser aurait
  laissé un second compteur affichant zéro pendant que la collectivité dépense son mois ailleurs.
- **Le message de plafond atteint vient du Socle mot pour mot** (il nomme la date de
  renouvellement) : le recomposer côté Clara ferait diverger deux calculs de période, et mentir la
  date.

Client unique : `supabase/functions/_shared/socleAi.ts`. Voir aussi `docs/edge-functions.md`.

## 3. Workflows

- Configurables par org dans `Workflows.tsx` / `WorkflowDetail.tsx` (éditeur visuel React Flow, `@xyflow/react`).
- Deux types (`kind`) : workflow principal des courriers, et workflow des réponses.
- Chaque `workflow_state` a une `category` : `draft`, `in_progress`, `processed`, `archived` — détermine l'onglet d'affichage (`CourriersEnInstruction`, `CourriersTraites`, `CourriersArchives`).
- Transitions définies par `workflow_transitions`. La validité des transitions est vérifiée côté client (et idéalement par trigger DB pour les cas critiques).
- **Changer d'organisation gestionnaire** (carte « Organisation gestionnaire », colonne de contexte de `/courrier/:id` et panneau de la boîte aux lettres) : à l'état initial c'est une simple affectation ; ensuite c'est un **transfert**, confirmé par un dialogue, qui **remet le courrier à l'état initial du workflow de l'organisation cible** (chaque organisation a son workflow), journalise `service_transferred` et notifie les membres de la cible. Le panneau de tri se referme après le transfert (le courrier quitte la pile à trier) ; l'écran d'instruction, lui, reste ouvert sur le courrier — sauf transfert vers une organisation hors du périmètre de l'agent, qui n'aurait plus rien à afficher.

## 4. Actions issues d'un courrier

Clara ne remplace pas les applications métier qui exécutent les demandes d'action. Elle sert de point de suivi côté courrier :

- **une action EST une demande fondée sur une démarche**, déposée chez qui l'instruit : Iris pour les démarches du référentiel, le partenaire pour les démarches Arpège. Clara conserve le lien et l'état de résolution utiles à la réponse ;
- l'analyse IA peut recommander des actions, mais l'agent reste responsable de la décision et du circuit retenu.

**Plus d'action « libre » depuis le 2026-09-11** : la démarche est obligatoire dans le dialogue, qui ne propose que les démarches Iris ou partenaire (`src/lib/procedure-origin.ts` — une démarche sans origine, embryon local, n'est plus proposée). Avec elle disparaissent les champs que Clara ajoutait de son côté — **titre de l'action, affecté à, descriptif** — et la modification d'un ticket : une demande instruite ailleurs ne s'édite pas dans Clara (elle se supprime, ou se renvoie si le dépôt a échoué). Les colonnes `title` / `description` / `assignee_id` d'`action_tickets` ne servent plus qu'à afficher les tickets antérieurs ; l'edge `send-assignment-notification` n'a donc plus d'appelant.

### Dépôt dans Iris (depuis le 2026-08-23)

**Iris est propriétaire exclusif des demandes d'usagers de la gamme.** Une action fondée sur une
**démarche du référentiel** y est déposée à sa création (`push-iris-request`), puis instruite
là-bas ; Clara en suit l'état (référence, statut, permalien) sans le piloter. `socle_procedure_id`
est obligatoire côté Iris : la frontière tombe du contrat, et une action sans démarche du
référentiel (ticket d'avant le 2026-09-11, démarche Arpège) reste dans Clara.

**Le formulaire de la démarche se saisit comme dans Iris** (depuis le 2026-09-11) : sections en
cartes titrées, choix courts en pastilles, repère « conditionnel », et surtout le bloc **« Lieu
d'intervention » saisi comme UNE adresse** — propositions de la Base Adresse Nationale pendant la
frappe, et **carte de contrôle dès la saisie**, avec la réserve du géocodeur (« Numéro localisé »,
« Voie localisée — numéro non trouvé »…). L'adresse du **demandeur** est assistée de la même
façon. Rien n'est inventé : on écrit dans les champs que la démarche pose (`intervention_numero`,
`intervention_voie`…), ce qu'aucun champ ne peut porter rejoint la voie, et **aucune coordonnée
n'est stockée**. Détail : `docs/conventions.md` § Adresse et carte.

**Les pièces réclamées par le formulaire de la démarche partent avec la demande** (depuis le
2026-09-11) : chaque fichier coché par l'agent est déposé sur `POST /v1/uploads`, puis référencé
par son `upload_id` — Iris ne vient jamais lire un fichier chez Clara. Un format qu'Iris n'admet
pas ne bloque pas le dépôt : la demande part sans la pièce, et le ticket le dit
(`iris_attachments_error`). Détail : `docs/iris-integration.md` § 5 bis.

Le ticket est créé **d'abord** (son id est l'`external_id` d'Iris) : un dépôt en échec ne perd
rien, il se rejoue depuis l'onglet « Actions liées » avec la même clé d'idempotence. Un tenant
sans interface Iris ne voit rien — il ne dépose simplement pas ses demandes là-bas. Statuts
relus chaque nuit par `sync-iris-requests` (03:30), avec garde de version monotone.

**L'agent choisit l'organisation destinataire** (depuis le 2026-09-10). Le dialogue « Nouvelle
demande » ouvre sur ce choix — suggestion de l'analyse IA, à défaut l'organisation gestionnaire
du courrier — et **n'offre ensuite que les démarches que cette organisation assure** dans le
référentiel (miroir `procedure_organizations`). Adresser une demande aux services techniques ne
déplace pas le courrier : l'organisation retenue est portée par l'action
(`action_tickets.socle_organization_id`), pas par le courrier. Une démarche **Arpège** n'est pas
connue du référentiel : sans activation, elle reste proposée quelle que soit l'organisation.

Détail complet — contrat, raccordement des champs, périmètre, exploitation :
`docs/iris-integration.md`.

## 5. Réponses (couriers sortants)

- Modèle : un courrier `direction=outbound` avec `parent_courier_id` pointant l'inbound.
- Service : `src/services/courierReplyService.ts` — création, édition, signature, transitions, envoi.
- **Signature** : sélection d'un `signatory` → l'image de signature est intégrée dans le HTML avec un marker `<img alt="signature-clara">`. `stripSignatureBlock()` permet de retirer le bloc avant ré-édition.
- **Adresse du destinataire** : celle portée par le courrier (participant `sender`) d'abord, **sinon celle de la fiche du référentiel** liée par `socle_contact_id`. Le participant n'est qu'un instantané du dépôt : sans ce repli, un courrier reçu alors que l'usager n'avait pas d'email restait « sans adresse » même après l'ajout de l'email sur sa fiche. Le repli est appliqué des deux côtés — `useCourierWorkspace` (`senderReplyEmail`, active le canal Courriel) et `send-courier-reply` (dernier recours avant le 400).
- **Envoi SMTP** : edge function `send-courier-reply` envoie via le serveur d'envoi de l'org. Marque `metadata.sent_email_at`. Déclenchée par une transition vers un état de catégorie `processed`.
- **D'où vient le relais** : du **Socle**, pas de Clara (depuis le 2026-08-23). Il se définit une fois pour toute la gamme sur l'organisation racine ; `sync-socle-referentiel` en recopie un miroir dans `smtp_settings`. Plus aucun écran de saisie ni test d'envoi dans Clara — le diagnostic se fait dans le référentiel. Conséquence : **un tenant sans relais déclaré n'expédie rien** (aucun relais de repli), et l'adresse d'expédition est celle du référentiel, pas celle qui avait pu être saisie à la main. Détail du miroir : `docs/data-model.md` § `smtp_settings`.

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

## 7. Démarches & intégration partenaire (Arpège)

- Table `procedures` (multi-tenant, RLS via `is_member_of` / `is_admin_of`). **Source de vérité : le Socle** (sync nocturne `sync-socle-referentiel`, cf. §Socle) — Clara ne crée/modifie plus les démarches, hors toggle de visibilité `is_displayed`. Le catalogue est l'**union du sous-arbre d'organisations** du tenant, et `procedure_organizations` dit qui assure quoi (colonne « Assurée par » dans `ProceduresSettings.tsx`) : le filtre `enabled_for` du Socle n'étant pas récursif, la sync interroge chaque organisation.
- Résidu partenaire : `external_reference_id` + `external_source` (`arpege` legacy) + `arpege_config_fields` (jsonb) — nécessaires pour **poster une demande** chez Arpège. UI : `ProceduresSettings.tsx` (badge « Arpège » sur les démarches d'origine partenaire).
- **Intégration partenaire** (spec + refonte en cours : `docs/partenaires-integration.md`) : config de connexion par tenant dans `organization_integrations` (superadmin), récupération manuelle des démarches via l'edge `sync-arpege-services` (bouton superadmin — le cron `sync-arpege-procedures-nightly` et sa fonction SQL `trigger_arpege_sync()` sont **décommissionnés**, migrations `20260711091000` + `20260723155049`), création de demandes via `create-arpege-demande` (tickets `action_tickets.arpege_demande_ref/status`), suivi de statut via `check-arpege-ticket-status` (badge dans `LinkedActionsTab`).
- `sync-arpege-appointments` (RDV) : **supprimée** (morte — aucun appelant, aucune écriture).

## 8. Notifications

- Table `notifications` + cloche `NotificationBell.tsx` + hook `useNotifications`.
- Quatre types aujourd'hui : `new_courier` (fan-out à tous les membres actifs de l'org, par
  `fn_create_courier_notifications`, sauf l'auteur du courrier), `courier_transferred`
  (inséré côté client depuis `useCourierWorkspace`), `action_assigned` et `action_unassigned`
  (edge `send-assignment-notification`, sans appelant depuis le 2026-09-11).
- Le `title` de la ligne est **déjà une phrase française**, préfixée par le producteur
  (« Transféré : … ») ; la cloche retire ce préfixe à l'affichage, et le push aussi.

### Push sur appareil (Web Push / VAPID, 2026-09-11)

La cloche ne sonne que si Clara est ouverte dans un onglet. Un courrier qui arrive à 17 h 50,
une action affectée pendant une réunion : personne ne l'apprend avant le lendemain. Le push met
la même information sur l'écran verrouillé, **application fermée**.

- **Le push SUIT la cloche.** Aucun réglage par type d'événement : ce qui entre dans
  `notifications` part sur les appareils inscrits. Le seul réglage est **par appareil** —
  l'interrupteur « Notifications sur cet appareil » (`PushDeviceToggle`, sur « Mon profil »).
  ⚠️ **Conséquence à surveiller** : `new_courier` est un fan-out vers TOUS les membres actifs.
  Une collectivité qui reçoit trente courriers par jour fera vibrer trente fois chaque téléphone
  inscrit. Si cela devient bruyant, la règle vit **dans un seul endroit** — le trigger
  `notifications_push_queue()` —, pas dans les producteurs.
- **`push_subscriptions`** : UN abonnement PAR APPAREIL (endpoint du service de push, clés
  `p256dh`/`auth` — publiques par construction, elles servent à chiffrer VERS l'appareil).
  L'enregistrement passe par la RPC **`register_push_subscription`** (DEFINER), seule porte
  d'écriture : sur un poste partagé d'accueil, le navigateur rend le **même endpoint** au
  titulaire suivant, et la RPC **reprend** la ligne (`on conflict (endpoint) do update set
  user_id`), ce qu'un `insert` borné à `user_id = auth.uid()` ne pourrait pas. La table n'est
  **pas** scopée par organisation : un téléphone appartient à un compte, et le cloisonnement
  reste porté par `notifications`, qui l'est.
- **`push_status`** (+ `push_attempts`, `push_attempted_at`, `push_sent_at`,
  `push_next_attempt_at`, `push_error`) sur `notifications`. La valeur initiale est décidée par
  le trigger **`trg_notifications_push_queue`** (BEFORE INSERT) : `pending` ssi le destinataire
  a au moins un appareil actif, `skipped` sinon — une règle, appliquée aux trois sites
  d'insertion sans toucher aucun producteur. Un producteur qui poserait `push_status` serait
  écrasé : voulu.
- **Le facteur** : edge function `notifications-push` sur cron (`* * * * *`, même porte que le
  worker d'analyse — `x-cron-secret` comparé à `get_cron_secret()`, aucun CORS).
  `claim_notification_pushes` renonce d'abord aux lignes **déjà lues** (fréquent : Clara en
  marque en masse quand un courrier quitte « à traiter ») et à celles **sans appareil actif**,
  puis réclame atomiquement avec les appareils du destinataire en JSON. Un envoi par appareil ;
  la ligne est `sent` dès qu'UN appareil a reçu ; 404/410 ⇒ `disable_push_subscription` ; le
  reste ⇒ temporisation croissante (2, 4, 8, 16 min) puis `failed` à la 5ᵉ tentative
  (`_shared/push/outcome.ts`, pur, testé). **Sans clés VAPID, la fonction répond 503 sans
  réclamer** : réclamer consommerait les tentatives d'une file qu'elle ne peut pas servir.
- **Ce qui sort** (`_shared/push/message.ts`, pur, testé) : titre = motif · collectivité ;
  corps = l'objet du courrier (ou le libellé de l'action), tronqué à 140 caractères. Jamais le
  corps du courrier, son analyse, son expéditeur ni ses pièces. L'objet, lui, EST repris : il
  quitte déjà Clara par les e-mails de notification, et sans lui la carte ne distingue rien.
  Texte chiffré de bout en bout (RFC 8291) : le service de push ne le lit pas.
  `tag = clara:<resource_id>` — une carte par courrier, la plus récente remplace. Le clic mène
  là où mène la cloche : `/courrier/<id>?tab=actions` pour une action, `/boite-aux-lettres?open=<id>`
  sinon (parité figée par un test).
- **Service worker `public/sw.js` — push SEUL** : aucun `fetch`, aucun cache (une GEC ne doit
  jamais servir un état de workflow périmé). Enregistré **à l'activation de l'interrupteur**,
  jamais au démarrage. `PushBootstrap` (monté une fois dans `ProtectedRoutes`) touche
  `last_seen_at` et écoute le worker : `clara:navigate` (clic quand l'app est ouverte) et
  `clara:push-resubscribed` (rotation d'abonnement par le navigateur).
- **Déconnexion** : `signOut` retire l'abonnement de l'appareil (best effort) — poste partagé.
  Un abonnement du navigateur **sans ligne à moi** est retiré à la lecture d'état.
- **Clé publique VAPID** en `VITE_VAPID_PUBLIC_KEY` : elle voyage dans chaque abonnement, ce
  n'est pas un secret (cf. `.env.example`). Clé privée et sujet (`VAPID_PRIVATE_KEY`,
  `VAPID_SUBJECT`) dans les secrets d'edge functions. Absente ⇒ état `not_configured`, rien ne
  casse.
- **iOS** : Safari n'expose le push qu'en application AJOUTÉE À L'ÉCRAN D'ACCUEIL (≥ 16.4) ;
  l'état `needs_install` l'explique. C'est une détection de **capacité**, pas de layout.
  ⚠️ Ce conseil n'a d'issue que parce que Clara est **installable** (2026-09-11) :
  `public/manifest.webmanifest` (`display: standalone`) + les métadonnées d'`index.html`.
  Sans elles, l'icône posée depuis un iPhone rouvre un onglet Safari ordinaire,
  `display-mode: standalone` reste faux, et l'agent relit indéfiniment le même message.
  Deux pièges portés en commentaire dans `index.html` : iOS **ignore le manifeste pour
  l'icône** (`apple-touch-icon` est obligatoire), et cette icône doit être **opaque**,
  une transparence étant remplie en NOIR.
  Les icônes sont dérivées du vectoriel `public/icons/clara-mark.svg` (le favicon 32×32
  était trop petit pour être agrandi) en trois variantes, parce qu'elles ne subissent pas
  le même traitement : `apple-touch-icon.png` 180 **plein et opaque** (iOS applique son
  propre masque), `icon-192/512.png` à coins arrondis transparents comme le favicon, et
  `icon-maskable-512.png` dont le dessin est ramené à 70 % pour survivre au masque
  circulaire d'Android.
- Fichiers : `src/lib/push.ts` (pur, testé — 30 cas), `src/services/pushSubscriptionService.ts`,
  `src/hooks/usePushSubscription.ts`, `src/components/PushDeviceToggle.tsx`, `public/sw.js`,
  `supabase/functions/_shared/push/{config,message,outcome,transport}.ts` (les trois premiers
  purs, testés — 45 cas), `supabase/functions/notifications-push/index.ts`.

## 9. Tags & recherche

- Tags libres par org (`courier_tags`), en **deux groupes** depuis le 2026-09-10 : **Thème** (de quoi parle le courrier) et **Sentiment** (sur quel ton). Un tag dit l'un ou l'autre, jamais les deux — mêlés, ils se comptaient ensemble dans les statistiques et se peignaient dans la même palette.
  - **Paramétrage** : `ClassificationSettings.tsx` — une carte par groupe, création / **modification** (nom, couleur, groupe) / suppression dans chacune. Renommer un tag ne renomme pas ce qui est déjà appliqué (le nom est la clé) : l'écran le dit.
  - **Code couleur** (`src/services/courierTagService.ts`) : le sentiment suit un **dégradé vert → rouge ordonné par valence** — la position porte le sens, c'est ce qui rend une courbe lisible ; le thème prend des **teintes diversifiées**, ni vertes ni rouges, pour ne pas se lire comme une alerte.
  - **Sur le courrier** : le panneau latéral affiche une rangée par groupe, avec un sélecteur par groupe ; l'onglet Contenu et intentions range de même les tags proposés par l'analyse.
  - **Analyse IA** : le prompt sert **deux listes** et le schéma **deux champs** (`intents` pour les thèmes, `sentiments` pour le ton — au plus un ou deux) ; la revalidation serveur vérifie l'appartenance **au bon groupe**, un modèle à qui l'on donne deux listes rangeant parfois un sentiment dans les thèmes. Le stockage, lui, reste une seule liste de noms.
  - **Statistiques** : deux courbes distinctes (`TagEvolutionChart` avec sa prop `group`), aux couleurs paramétrées des tags. Le RPC `stats_tag_evolution` rend le groupe.
- Contraste du texte sur un fond de tag : `src/lib/tag-color.ts` (gère `hsl(h s% l%)` autant que l'hexadécimal).
- Recherche côté pages courriers : ILIKE sur `subject` (cf `courierService.getCouriers`). Pour fulltext avancé, ajouter une colonne `tsvector` + index GIN (non fait à ce jour).

## 10. Super-admin

- Layout dédié `/superadmin/*` (`SuperAdminLayout`, `SuperAdminSidebar`).
- Gestion des organisations, création initiale, vue cross-org.
- Accès gardé par `isSuperAdmin(profile)` côté client **+** RLS server-side (les helpers `is_superadmin()` bypassent les filtres org).
