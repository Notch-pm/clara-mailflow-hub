
## Objectif
Récupérer automatiquement les emails reçus sur une adresse dédiée et créer un courrier par email — pièces jointes attachées comme documents, expéditeur enregistré comme participant.

## Approche recommandée : IMAP polling

Trois options techniquement possibles :

| Option | Avantages | Inconvénients |
|---|---|---|
| **IMAP polling** (recommandé) | Marche avec n'importe quelle boîte (Gmail, Outlook, OVH, IONOS, free…). Cohérent avec ton SMTP par organisation déjà en place. | Latence ~5 min selon fréquence du cron |
| Webhook inbound (Postmark/SendGrid) | Temps réel | Compte tiers payant + redirection MX/sous-domaine dédié |
| Connecteur Outlook OAuth | OAuth propre | Limité aux comptes Microsoft 365 du dev (pas par-organisation), config lourde |

## Ce que je vais ajouter

### 1. Nouvelle table `imap_settings` (par organisation)
Champs : `host`, `port`, `username`, `password`, `use_tls`, `folder` (défaut `INBOX`), `auto_fetch`, `last_fetch_at`, `last_error`. RLS identiques à `smtp_settings`.

### 2. Section UI « Réception d'emails » dans les paramètres
À côté du SMTP, dans `SmtpSettings` (ou nouveau `ImapSettings`) :
- Hôte / port / identifiant / mot de passe / TLS / dossier
- Switch « Récupérer automatiquement »
- Bouton « Tester la connexion »
- Bouton « Récupérer maintenant »
- Affichage du dernier fetch et de la dernière erreur

### 3. Edge Function `fetch-inbound-emails`
Pour chaque organisation active :
- Connexion IMAP, sélection du dossier, recherche des messages **UNSEEN**
- Pour chaque email :
  - **Déduplication** sur `Message-ID` (stocké dans `couriers.metadata`)
  - Crée un `courier` : `direction=inbound`, `channel=email`, `subject`, `received_at`, `workflow_state_id` = état initial
  - Crée participant `sender` (nom + email expéditeur)
  - Crée participant `recipient` (adresse de la boîte)
  - Stocke corps HTML + texte dans `metadata.body_html` / `metadata.body_text`
  - Upload chaque pièce jointe dans le bucket `clara-documents` + ligne `courier_documents`
  - Marque l'email `\Seen`
  - Logge un `courier_event` `email_received`
- Met à jour `last_fetch_at` / `last_error`

Bibliothèques : `npm:imapflow` + `npm:mailparser`.

### 4. Planification automatique
`pg_cron` toutes les 5 min appelle `fetch-inbound-emails` avec `CRON_SECRET` (même pattern que `trigger_arpege_sync`).

## Ce que tu devras faire de ton côté
1. **Créer (ou réutiliser) une boîte mail dédiée** par organisation, ex. `courrier@monorga.fr`. Idéalement pas une boîte personnelle.
2. **Activer IMAP** sur cette boîte (souvent désactivé par défaut chez Gmail/Outlook).
3. **Générer un mot de passe d'application** si la boîte a la 2FA (Gmail, Outlook, iCloud…).
4. Renseigner dans Clara : hôte IMAP (ex. `imap.gmail.com:993`), identifiant, mot de passe d'application.
5. Cliquer sur « Tester » puis activer la récupération auto.

## Limites assumées
- Pas de réponse depuis Clara dans cette itération (réception uniquement)
- Emails > taille max org : pièces jointes rejetées avec un courrier_event d'avertissement
- Seuls les emails UNSEEN sont récupérés (pas l'historique antérieur à l'activation)
- Les emails récupérés sont marqués comme lus dans la boîte source

<lov-actions>
<lov-suggestion message="OK, lance l'implémentation : table imap_settings + UI + edge function + cron toutes les 5 minutes.">Lancer l'implémentation IMAP</lov-suggestion>
<lov-suggestion message="Avant de coder, ajoute aussi la possibilité d'avoir plusieurs adresses IMAP par organisation (ex. une par service).">Plusieurs adresses par organisation</lov-suggestion>
<lov-suggestion message="Je préfère utiliser un webhook inbound (Postmark ou SendGrid) plutôt que l'IMAP polling. Décris-moi ce que ça implique.">Plutôt webhook inbound</lov-suggestion>
<lov-suggestion message="Génère aussi un PDF du corps de l'email comme pièce jointe du courrier, en plus des vraies pièces jointes.">PDF du corps en pièce jointe</lov-suggestion>
</lov-actions>
