# Dette technique — backlog priorisé

> Audit du 2026-07-11 (advisors Supabase, knip, inventaire manuel après l'intégration Socle).
> Re-générer les mesures : `bun run audit` (knip) + advisors MCP (`get_advisors security|performance`).
> **Règle : jamais de refactor sans le filet de tests** (`bun run test` + `test:integration` + `test:e2e`).

## P0 — Sécurité (fait ou action utilisateur)

| Item | État |
|---|---|
| `search_couriers` exécutable par `anon` (grant PUBLIC re-créé avec la fonction) | ✅ corrigé (`20260711210000`) — ⚠️ à re-vérifier après CHAQUE re-création de fonction |
| Rotation `cron_secret` (valeur en clair dans la migration `20260417133227`) | ✅ tourné le 2026-07-11 (Vault) |
| `portal_form_submissions` sans policy explicite | ✅ policy service_role + commentaire |
| Leaked password protection (Dashboard → Auth → Providers → Password) | ⏳ **action utilisateur** — l'advisor sécurité la voit toujours désactivée au 2026-07-12 |
| Secret GitHub `SUPABASE_SERVICE_ROLE_KEY` (jobs integration/e2e de la CI) | ✅ (CI verte depuis le run #4) |

## P1 — Sécurité / correctness

1. **Mots de passe IMAP/SMTP en clair en DB** (`imap_settings.password`, `smtp_settings`) — chiffrer (Vault par ligne ou pgsodium) + adapter `fetch-inbound-emails`, `send-courier-reply`, `send-test-email`. Gros item, à planifier seul.
2. ~~**RLS `auth_rls_initplan` (32 policies)**~~ ✅ corrigé (`20260712090000_rls_consolidation_advisors`) — wrap `(select auth.uid())` + helpers.
3. ~~**`multiple_permissive_policies` (29 cas)**~~ ✅ corrigé (même migration) — une policy par (table, rôle, action), `service_role_full` recréées `TO service_role`, durcissement des policies `users` (voir `docs/database-rls.md`).
4. **20 FK sans index** (`action_tickets.created_by`, `courier_documents.organization_id`, …) : ajouter les index couvrants ; **20 index jamais utilisés** à supprimer (attention : le projet n'a pas encore de trafic réel, re-vérifier avant suppression).
5. **Numérisation — reste à faire** (paliers 0–2 livrés le 2026-07-18, cf. `docs/features.md` §1) :
   - **Dé-lotissement des PDF multi-courriers.** Un chargeur automatique produit un PDF de 60 pages là où Clara veut 30 courriers. Parade actuelle : configurer le copieur en « un fichier par document ». Conception retenue si besoin : découpe manuelle assistée **côté navigateur** (`pdf-lib` + `pdfjs-dist`, chargés en `await import()` sur `/import-en-masse`), produisant des `BulkFile` à `groupId` distincts — les étapes 3-4 du wizard restent inchangées. Détection de page blanche possible en *suggestion* (le recto-verso crée des faux séparateurs) ; **impossible côté Deno** (`unpdf` ne rend que du texte, et un scan n'a aucune couche texte).
   - **Capture mobile.** Ne pas poser `capture="environment"` sur l'input `multiple` existant : cela force l'appareil photo et supprime le sélecteur de fichiers sur plusieurs navigateurs. Prévoir un second bouton dédié. Le vrai gain est la **recompression client** (canvas, 2000 px, JPEG q0.8 : 4-8 Mo → ~500 Ko), qui réduit upload, stockage **et coût OCR**.
   - **Appliquer l'expéditeur suggéré.** Seul le titre est applicable en un clic (`ContentIntentsTab`) ; l'expéditeur et le service restent indicatifs, faute d'un rapprochement conçu avec le référentiel du Socle.
6. **Bump Vite** — 3 alertes Dependabot (au 2026-07-13) : `vite` high (bypass `server.fs.deny` via chemins alternatifs Windows) + `vite` medium (variante path traversal) + `launch-editor` medium (fuite hash NTLMv2 via UNC, Windows). N'affecte que le dev server (`bun run dev`), pas le build prod — mais le dev se fait sous Windows. Petit item : bump + `bun run test`/`build`. Alertes : <https://github.com/Notch-pm/clara-mailflow-hub/security/dependabot>.
7. **Incohérence `is_active = NULL` entre RLS SQL et gardes edge** (signalé le 2026-07-22 pendant le durcissement `consultant`). Les helpers SQL (`is_member_of`, `is_admin_of`, `is_editor_of`) évaluent l'appartenance avec `COALESCE(is_active, true) = true` → un membre au `is_active` **NULL est traité comme ACTIF**. À l'inverse, les gardes des edge functions (`supabase/functions/_shared/authz.ts::assertEditor` et les `verifyOrgMembership` locaux de `storage-documents`, `analyze-courier`, `send-courier-reply`, …) utilisent `.eq("is_active", true)` → **NULL traité comme INACTIF**. Conséquence : un membre `is_active=NULL` passerait la RLS (écriture DB directe) mais serait refusé par les edge functions. **Pas de risque de sécurité** (l'edge est plus restrictif que la RLS) et **sans impact sur le `consultant`** (bloqué dans les deux cas via le rôle) — mais divergence à harmoniser. Deux parades : soit `COALESCE(is_active, true)` dans tous les gardes edge, soit imposer `organization_users.is_active NOT NULL DEFAULT true` en base (plus radical, ferme la question à la source). Passe transverse sur tous les helpers `verifyOrgMembership`-like.

## P2 — Code mort (knip, faux positifs exclus)

**Vrais orphelins à supprimer :**
- `src/pages/CourriersEntrants.tsx` — **page sans route** (la BAL l'a remplacée) ; sa logique colonne/export est dupliquée ailleurs.
- `src/pages/Index.tsx`, `src/App.css`. (`BulkStep3Analyze.tsx` supprimé le 2026-07-18.)
- `src/services/courierLinkService.ts`, `src/services/courierSequenceService.ts` (plus consommés).
- `src/services/orgServiceService.ts` — legacy services gelé : ne garder que ce que `fetch-inbound-emails`/`portal-form` lisent côté SQL (rien côté client). Supprimer avec `listServiceSignatoryIds`/`setServiceSignatories` (signatoryService).
- **16 dépendances npm inutilisées** (recharts, react-day-picker, vaul, input-otp, react-resizable-panels, @radix-ui/* des composants ui non utilisés…) — retirer avec les composants shadcn associés (calendar, chart, carousel, drawer…) si on assume de les réinstaller au besoin.
- ~68 exports morts (voir `bun run audit`) — nettoyage mécanique.

**Legacy Socle (attendre quelques semaines de recul avant suppression) :**
- Tables `services`, `service_members`, `service_signatories` (gelées, migrées le 2026-07-11).
- `portal_forms.service_id`, `couriers.metadata.service_id` (remplacés par `socle_organization_id`).
- Edge functions `sync-arpege-*`, `create-arpege-demande`, `check-arpege-ticket-status`, `test-arpege-connection` (Arpège décommissionné du cron ; `create-arpege-demande` encore utile si tickets Arpège actifs).

## P2 — Architecture

1. **5 pages listes courriers quasi identiques** (`CourriersTraites/Archives/EnInstruction/Sortants` + `BoiteAuxLettres` partiellement) : mêmes colonnes, filtres, export CSV, `applyServiceFilter` → factoriser un composant/hook `CourierListPage`. Grosse réduction de surface (~1500 lignes), à faire APRÈS les E2E (déjà en place).
2. **Composants géants** : `MailboxSidePanel.tsx` (61 Ko), `ReplyComposer.tsx` (46 Ko), `NewCourierDialog.tsx` (40 Ko) — découper en sous-composants/hooks (une PR chacun). (`Usagers.tsx` soldé le 2026-07-16 : remplacé par `Contacts.tsx` branché sur le Socle.)
3. **131 casts `as any`/`as never`** alors que le client Supabase est typé (`Database`) — la majorité date d'avant la régénération des types. Cible < 30.
4. `couriers.metadata` fourre-tout (tags, body, imap_settings_id, socle_organization_id dupliqué) — schéma à documenter, puis promouvoir les champs stables en colonnes.
5. ~~**Rapprochement de contacts à faire porter par le Socle**~~ ✅ 2026-07-17 — le Socle expose `POST /v1/contacts/match` (`pg_trgm` + `unaccent` en SQL). Clara délègue : un seul appel par saisie (action `match` du proxy), plus de moteur de comparaison local, les trois angles morts (téléphone seul, début du nom, accents) sont levés. Voir `docs/features.md` § Détection de doublons.

## Config audit

- `bun run audit` = knip avec faux positifs exclus (edge functions Deno, bibliothèque shadcn `src/components/ui`, page morte connue en attente de suppression).
- Advisors : MCP Supabase `get_advisors` (`security` re-run après chaque migration ; `performance` mensuel).
- Inventaire RLS : `scripts/rls-inventory.sql` (tables × policies × rôles) — à exécuter via MCP/psql pour revue.

## Ordre recommandé

1. Actions utilisateur P0 (2 clics + 1 secret GitHub).
2. ~~P1.2 + P1.3 (consolidation RLS)~~ ✅ 2026-07-12.
3. P2 code mort (une PR knip).
4. P2.1 factorisation des listes (une PR, validée par E2E).
5. P1.1 chiffrement IMAP/SMTP (chantier dédié).
6. P2.2 découpage des composants géants (PRs successives).
