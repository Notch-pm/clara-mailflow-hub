# Suite E2E (Playwright)

Pilote réellement l'interface (clics, saisies, téléversements) contre le serveur Vite local et le
projet Supabase live, **tenants `[TEST]` uniquement**.

```bash
bun run seed:test                      # (re)crée Alpha/Beta + comptes par rôle + circuit complet
bun run test:e2e                       # suite complète, headless (rapport : playwright-report/)
bun run test:e2e:headed                # navigateur visible, ralenti (300 ms)
E2E_SLOWMO=700 bun run test:e2e:headed -- e2e/reponse   # plus lent, un domaine
```

Variables : `SUPABASE_SERVICE_ROLE_KEY` (préparation/vérification de données et miroir SMTP de test ;
sans elle, les specs concernées sont **sautées** avec leur raison), `VITE_SUPABASE_URL` /
`VITE_SUPABASE_PUBLISHABLE_KEY` (ou `.env`).

## Organisation

| Dossier | Contenu |
|---|---|
| `sources/` | saisie (avec/sans OCR-IA), import IMAP (avec/sans organisation), boîte de numérisation, import en masse |
| `traitement/` | cycle de vie du workflow, tâches (mail réel + lien `/tache/:token`), erreurs / états vides / concurrence, démarches Iris/Arpège (fixme) |
| `reponse/` | circuit complet : brouillon IA → visa → signature → envoi (mail lu) → clôture → archivage |
| `sortants/` | courrier à l'initiative : rédaction assistée, visa, signature, envoi |
| `securite/` | étanchéité tenants (URL, caches, Storage) et organisations d'un même tenant |
| `droits/` | matrice rôles (administrateur, gestionnaire, élu, superviseur, consultant) + viseur / signataire |
| `support/` | `admin.ts` (service_role, [TEST] seulement), `mailbox.ts` (Ethereal + garde-fou destinataires), `files.ts` (PDF fabriqués), `fixtures.ts` (`needMail`, `needAdmin`) |

## Infrastructure mail de test

`global-setup.ts` crée 3 boîtes **Ethereal** jetables (SMTP qui capture sans livrer, lisible en IMAP),
pose la première comme relais SMTP de `[TEST] Alpha` (RPC `sync_smtp_settings_from_socle`) et garde
les identifiants **en mémoire du process** (jamais sur disque). Les mails de Clara y arrivent et sont
lus pour de vrai (objet, destinataire, contenu, lien). Toute adresse saisie par un test passe par
`testRecipient()` / `assertTestRecipient()` : seuls `example.test` & co. sont admis.

## Conventions

- Chaque test crée ses données avec `uniq()` (`[TEST] E2E … <runId>`), jamais d'id en dur (relire `fixtures.json`).
- `test.fail(true, raison)` = **défaut applicatif connu** : vert tant qu'il existe, rouge le jour où il est corrigé (retirer alors l'annotation).
- `test.fixme(…)` = scénario bloqué par une dépendance externe, raison dans le titre.
- Les tenants `[TEST]` sont reseedés par la CI à chaque push sur main : ne pas lancer la suite pendant ce reseed.
