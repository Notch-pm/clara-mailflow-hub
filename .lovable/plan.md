## Bouton « Signer » dans la réponse + verrouillage post-signature

### Comportement attendu

1. Quand le courrier de réponse est dans un **état avec `requires_signature = true`** :
   - Si le **signataire sélectionné correspond à l'utilisateur connecté** (`signatories.user_id === auth.uid()`) ET qu'il dispose d'une **image de signature**, un bouton **« Signer »** apparaît dans la barre d'actions de l'onglet Réponse.
   - Au clic, le bloc signature est ajouté en bas du corps HTML de la réponse :
     ```
     <p>Prénom Nom</p>
     <p><em>Titre</em></p>          (si renseigné)
     <img src="…signed url…" />      (image signature, hauteur ~80px)
     ```
   - La réponse est marquée **signée** (`metadata.signed_at`, `metadata.signed_by`) et devient **non modifiable** (éditeur + canal + signataire grisés, comme un état final).

2. Tant que **la signature n'a pas été apposée** sur un état `requires_signature`, **les transitions vers un état suivant sont bloquées** (boutons grisés).

3. **Tooltips sur tous les boutons grisés** indiquant la raison :
   - « Sélectionnez d'abord un signataire »
   - « En attente de signature »
   - « Vous n'êtes pas le signataire désigné »
   - « Aucune signature manuscrite enregistrée pour ce signataire »
   - « Réponse verrouillée »

### Détails techniques

**Fichiers modifiés** :
- `src/services/courierReplyService.ts`
  - Étendre `updateReplyContent` pour accepter `signedAt`, `signedBy` (stockés dans `metadata`).
  - Nouvelle fonction `signReply(orgId, parentCourierId, replyId, { bodyHtml, signedBy })` : update body + `metadata.signed_at = now`, `metadata.signed_by = userId`, log événement `reply_signed`.
- `src/components/courier/ReplyComposer.tsx`
  - Récupérer la **signature complète** (`first_name`, `last_name`, `title`, `user_id`, `signature_storage_key`) du signataire sélectionné (ajouter `signature_storage_key` au query `service-signatories-detailed`).
  - Récupérer l'utilisateur courant via `useAuth()` (contexte existant).
  - Calculer `isSigned = !!metadata.signed_at`, `isSignatureState = currentState.requires_signature === true`.
  - `editorDisabled` devient vrai aussi si `isSigned`.
  - Nouveau bouton **« Signer »** affiché si `isSignatureState && !isSigned` :
    - activé uniquement si `selectedSignatory.user_id === currentUser.id` ET `signature_storage_key` présent.
    - sinon grisé avec tooltip approprié.
    - au clic : génère URL signée (`getSignatureUrl`), construit le HTML signature, appelle `signReply`, refetch.
  - Boutons de transition : si l'état courant est `requires_signature` et `!isSigned`, bloquer toutes les transitions sortantes avec tooltip « En attente de signature ».
  - Wrapper `Tooltip` autour de chaque bouton désactivé avec la raison spécifique.
  - Badge « Signé » (icône `CheckCircle2`) affiché quand `isSigned`.

**Pas de migration DB** : on réutilise le champ `metadata jsonb` existant sur `couriers` pour stocker `signed_at` et `signed_by`.

### Diagramme de logique du bouton « Signer »

```text
état courant.requires_signature ?
  └── non  → pas de bouton
  └── oui  → déjà signé ?
              └── oui → badge "Signé", éditeur verrouillé
              └── non → signataire sélectionné ?
                          └── non → bouton grisé "Sélectionnez un signataire"
                          └── oui → signataire == utilisateur connecté ?
                                      └── non → bouton grisé "Vous n'êtes pas le signataire désigné"
                                      └── oui → image signature présente ?
                                                  └── non → bouton grisé "Aucune signature manuscrite enregistrée"
                                                  └── oui → bouton actif "Signer"
```
