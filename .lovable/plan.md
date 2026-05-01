## Objectif

Dans le panneau latéral d'un courrier en instruction, l'onglet **Réponse** devient un véritable composeur de réponse :

1. Choix du canal de réponse : **courrier** (papier) ou **courriel** (option désactivée si l'expéditeur n'a pas d'email).
2. Un grand **éditeur de texte riche** pour rédiger la réponse.
3. Des **boutons d'action** correspondant aux transitions du workflow « Reply » du service, en démarrant à l'état initial (« Non répondu ») et progressant via les transitions définies.

## Modèle de données

Aucune nouvelle table. On réutilise les tables existantes :

- **`couriers`** : la réponse est créée comme un courrier enfant
  - `direction = 'outbound'`
  - `parent_courier_id = <id du courrier reçu>`
  - `channel = 'paper' | 'email'` selon le choix
  - `subject` = repris du courrier parent (préfixé « Re: »)
  - `assigned_service` = celui du parent
  - `workflow_state_id` = état initial du `reply_workflow_id` du service
  - `metadata.body_html` (et `body_text`) pour le contenu de la réponse, comme on stocke déjà le corps des emails entrants
- **`courier_participants`** : on copie l'expéditeur du parent en `recipient` de la réponse, et on note le service comme `sender`.
- **`workflow_states` / `workflow_transitions`** : déjà présents — on lit ceux liés à `services.reply_workflow_id`.
- **`courier_events`** : on logge `reply_created`, `reply_state_changed`, `reply_sent`.

Une seule réponse active par courrier reçu (on cherche le child existant ; sinon on crée à la première interaction).

## UI / Composants

### Éditeur de texte riche
Ajouter **Tiptap** (`@tiptap/react`, `@tiptap/starter-kit`) — léger, headless, s'intègre bien à Tailwind/shadcn.

Nouveau composant : `src/components/ui/rich-text-editor.tsx`
- Toolbar minimale : gras, italique, souligné, listes, lien, titres H2/H3.
- Props : `value`, `onChange(html)`, `placeholder`, `disabled`.

### Onglet Réponse
Refonte de `TabsContent value="response"` dans `MailboxSidePanel.tsx`. Nouveau composant dédié : `src/components/courier/ReplyComposer.tsx`.

Layout :

```text
┌─────────────────────────────────────────────┐
│ Canal :  [● Courriel ] [○ Courrier ]        │  (radio)
│   (Courriel disabled si sender.email vide)   │
├─────────────────────────────────────────────┤
│ [Éditeur riche pleine largeur, ~min 320px]  │
│                                              │
├─────────────────────────────────────────────┤
│ État : Non répondu                          │
│ [Enregistrer brouillon] [→ En cours] [→ Répondu] │
└─────────────────────────────────────────────┘
```

Comportement des boutons :
- Lus depuis `workflow_transitions` du `reply_workflow_id` du service, à partir de l'état courant de la réponse (initial = `is_initial=true` du reply workflow → « Non répondu »).
- Chaque clic : `upsert` du child courier (création si inexistant), sauvegarde du HTML dans `metadata.body_html`, puis bascule du `workflow_state_id` vers la cible et log d'événement.
- Si la transition cible un état dont la `category = 'processed'` (« Répondu ») : le brouillon est verrouillé en lecture seule et l'éditeur passe en mode read-only.

### Service helper
Nouveau `src/services/courierReplyService.ts` :
- `getReplyForCourier(parentId)` → child outbound ou null
- `upsertReply(parentId, { channel, body_html })`
- `transitionReplyState(replyId, toStateId)`
- `getReplyWorkflow(serviceName, orgId)` → `{ states, transitions, initialState }`

## Détails techniques

- Le canal par défaut est `email` si `sender.email` existe, sinon `paper`.
- L'option « Courriel » est désactivée (avec tooltip « L'expéditeur n'a pas d'adresse email ») si pas d'email.
- Si le service du courrier n'a pas de `reply_workflow_id` configuré : afficher un message « Aucun workflow de réponse configuré pour ce service » et cacher les boutons (l'éditeur reste accessible pour brouillon en métadonnées du parent).
- Pas d'envoi réel d'email à ce stade : seul le bouton menant à l'état final logge `reply_sent`. L'envoi SMTP réel pourra être branché plus tard.
- L'invalidation React Query couvre `mailbox-couriers`, `courier-events`, et la nouvelle clé `courier-reply`.

## Fichiers impactés

- `package.json` : ajout de `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`.
- **Nouveau** `src/components/ui/rich-text-editor.tsx`
- **Nouveau** `src/components/courier/ReplyComposer.tsx`
- **Nouveau** `src/services/courierReplyService.ts`
- `src/components/courier/MailboxSidePanel.tsx` : remplacement du contenu de l'onglet Réponse par `<ReplyComposer />`.
