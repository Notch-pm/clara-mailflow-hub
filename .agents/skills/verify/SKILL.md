---
name: verify
description: Vérifier un changement Clara en conditions réelles — seed [TEST], dev server, connexion, navigation courrier.
---

# Vérifier Clara en conditions réelles

Pas d'environnement local Supabase : l'app dev pointe la base live
(`aullweizxcjbvtdspjli`). Les données de test vivent dans les tenants
préfixés `[TEST]` — on peut y écrire sans risque, le seed les purge.

## Environnement de test

```powershell
# Clé service_role sans l'afficher, puis seed (purge + recrée [TEST] Alpha/Beta)
$keys = bunx supabase projects api-keys --project-ref aullweizxcjbvtdspjli -o json | ConvertFrom-Json
$env:SUPABASE_SERVICE_ROLE_KEY = ($keys | Where-Object { $_.name -eq 'service_role' }).api_key
bun run seed:test
```

- Fixtures (ids org/courriers/workflows) : `src/test-integration/fixtures.json` (gitignoré).
- Utilisateurs : `admin.alpha@test.clara.local`, `membre.alpha@…`, idem `beta` — mot de passe `ClaraTest!2026`.
- Le seed ne crée NI procedures NI tickets : les insérer via SQL (MCP Supabase
  `execute_sql`) dans l'org `[TEST] Alpha` selon le besoin du test.
- Le seed est rejouable mais PURGE tout `[TEST]` : ne pas compter sur des données
  insérées à la main entre deux runs.

## Lancer et piloter

```powershell
bun run dev   # en arrière-plan ; port 8080, bascule sur 8081 si occupé — lire la sortie
```

Playwright MCP :
1. `http://localhost:<port>/` → redirection `/connexion` ; remplir le formulaire (email + mot de passe ci-dessus).
2. Détail courrier : `/courrier/<id>` (ids dans fixtures.json). Onglets : Détail, Contenu et intentions, Actions liées, Réponse.

## Pièges

- Échap ferme le Dialog Radix entier, pas seulement le popover interne.
- Le snapshot d'accessibilité peut montrer un popover « encore ouvert » juste après
  un clic d'option (animation) — re-snapshoter avant de conclure.
- Les captures d'écran atterrissent à la racine du repo : les déplacer vers le
  scratchpad après coup.
- Une autre session Codex peut occuper le port 8080 (cf. mémoire sessions parallèles).
