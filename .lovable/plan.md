# Mentions @utilisateur dans les notes internes

Ajouter la possibilité de mentionner un utilisateur de l'organisation dans une note interne via `@`, et notifier la personne mentionnée par email (template SMTP brandé déjà utilisé pour le reset password).

## UX

- Dans le `Textarea` d'ajout/édition d'une note (`NotesInlineSidebar.tsx`) :
  - Quand l'utilisateur tape `@`, un popover apparaît sous le curseur avec la liste des membres actifs de l'organisation.
  - Filtre en temps réel sur la frappe (`@jean` → filtre par prénom/nom/email).
  - Navigation clavier ↑/↓, validation `Enter` ou `Tab`, fermeture `Esc`.
  - Sélection → insère `@Prénom Nom ` dans le texte et stocke en parallèle l'`user_id` mentionné.
- Affichage des notes : les `@Prénom Nom` correspondant à une mention sont stylés (badge vert clair) pour les distinguer du texte.

## Données

- Pas de nouvelle table. On ajoute deux colonnes à `courier_notes` :
  - `mentioned_user_ids uuid[] not null default '{}'`
- Migration : `ALTER TABLE` + index GIN sur `mentioned_user_ids` (pour usages futurs). RLS inchangée.
- `createNote` / `updateNote` (service) acceptent désormais une liste de `mentioned_user_ids`. On compare ancien/nouveau pour ne notifier QUE les nouveaux mentionnés (pas de spam à chaque édition).

## Notification email

Nouvelle edge function `send-mention-notification` (réplique le pattern de `send-password-reset`) :

- Auth : JWT utilisateur + vérif membership de l'organisation.
- Inputs : `courier_id`, `note_id`, `mentioned_user_ids: string[]`.
- Pour chaque destinataire :
  - Récupère email + nom du destinataire, nom de l'auteur, objet du courrier, branding org.
  - Charge SMTP via `smtp_settings`.
  - Envoie via nodemailer avec le template HTML existant `buildBrandedEmail` (titre : « Vous avez été mentionné »), corps :
    > **{Auteur}** vient de vous mentionner dans une note interne du courrier **{Objet du courrier}**.
  - CTA « Voir le courrier » → `{APP_URL}/courrier/{courier_id}`.
- Idempotence simple : edge function ne traite que les IDs passés (la diff côté client garantit qu'un même utilisateur n'est notifié qu'une fois par ajout).

L'edge function est appelée depuis `createNote` / `updateNote` après succès via `supabase.functions.invoke`. Échec d'envoi → toast non bloquant, la note reste créée.

## Notification in-app (bonus mineur, même feature)

Insert dans `notifications` pour chaque utilisateur mentionné, type `note_mention`, avec `courier_id` + `note_id`. Permet d'apparaître dans la cloche existante. Si cela complexifie trop, je peux le retirer — dis-le moi.

## Fichiers touchés

- `supabase/migrations/<ts>_courier_notes_mentions.sql` — colonne + index.
- `src/services/courierNoteService.ts` — signature `createNote`/`updateNote` + invoke edge function.
- `src/components/courier/NotesInlineSidebar.tsx` — UI de mention (popover autocomplete, parsing du contenu).
- Nouveau `src/components/courier/MentionTextarea.tsx` — composant réutilisable encapsulant le `Textarea` + popover des membres.
- Nouveau `supabase/functions/send-mention-notification/index.ts`.
- `supabase/config.toml` — déclarer la nouvelle fonction si nécessaire.

## Hors scope

- Pas de mention de groupes/services.
- Pas de mention dans d'autres entités (commentaires, réponses) — uniquement notes internes.
- Pas de digest : 1 mention = 1 email immédiat.
