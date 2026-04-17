
## Plan : Onglet "Contenu et intentions" avec OCR Mistral + analyse LLM

### Vue d'ensemble
Pour chaque courrier ouvert dans le volet latéral (mode `withTabs`), l'onglet 2 affichera :
1. **Contenu textuel** des documents joints (extraction OCR Mistral pour PDF/images, lecture directe pour TXT)
2. **Analyse IA** (Mistral chat) : intentions, état d'esprit, actions suggérées
3. Bouton "Relancer l'analyse" + cache en base pour éviter de re-payer à chaque ouverture

### Architecture

```text
┌────────────────────┐       ┌──────────────────────┐       ┌─────────────┐
│ Onglet "Contenu et │──────▶│ Edge func            │──────▶│ Mistral OCR │
│ intentions" (React)│       │ analyze-courier      │       │ + Chat API  │
└────────────────────┘       └──────────────────────┘       └─────────────┘
        │                              │
        │                              ▼
        │                    ┌────────────────────┐
        └────lecture─────────│ courier_analyses   │ (nouvelle table)
                             │ + document_extracts│
                             └────────────────────┘
```

### Étapes

**1. Secret Mistral**
- Demander la clé API via `add_secret` (`MISTRAL_API_KEY`) — tu la fourniras quand on passera en mode default.

**2. Migration DB (2 tables)**
- `courier_document_extracts` : cache du texte OCR par document
  - `id, document_id (unique), organization_id, courier_id, text, page_count, model, tokens_used, created_at, updated_at`
- `courier_analyses` : analyse globale du courrier
  - `id, courier_id (unique), organization_id, intents (jsonb), sentiment (text), suggested_actions (jsonb), summary (text), model, created_at, updated_at`
- RLS : isolation `organization_id` (pattern existant via header `x-org-id`)

**3. Edge function `analyze-courier`** (`supabase/functions/analyze-courier/index.ts`)
- Auth JWT + vérif org membership (réutilise pattern `storage-documents`)
- Endpoints internes : `?action=ocr-document` (un doc), `?action=analyze` (tout le courrier)
- Pour OCR :
  - Génère un signed URL court pour le fichier dans le bucket `clara-documents`
  - Appelle `https://api.mistral.ai/v1/ocr` avec `model: mistral-ocr-latest` et `document_url`
  - Pour images : `image_url` ; pour PDF : `document_url` ; pour `text/*` : lecture directe sans OCR
  - Stocke le résultat dans `courier_document_extracts`
- Pour analyse :
  - Concatène les extraits, appelle `https://api.mistral.ai/v1/chat/completions` (modèle `mistral-large-latest`) avec tool calling pour sortie structurée : `{intents[], sentiment, suggested_actions[], summary}`
  - Stocke dans `courier_analyses`

**4. Service client** (`src/services/courierAnalysisService.ts`)
- `getExtracts(courierId)`, `getAnalysis(courierId)`, `runOcr(courierId)`, `runAnalysis(courierId)`

**5. Composant `ContentIntentsTab`** (`src/components/courier/ContentIntentsTab.tsx`)
- Section haute : "Contenu textuel des documents" — liste collapsible par document avec texte OCR (markdown rendu)
- Section basse : "Analyse" — cards pour Résumé / Intentions (badges) / État d'esprit (badge coloré) / Actions suggérées (liste)
- Boutons "Extraire le texte" / "Analyser" + état loading + dernière mise à jour
- Si pas de docs : message "Aucun document à analyser"

**6. Intégration dans `MailboxSidePanel.tsx`**
- Remplacer le placeholder de l'onglet `content` par `<ContentIntentsTab courierId organizationId />`

### Notes techniques
- **Mode 2 étapes** : OCR d'abord (par doc, cache permanent), puis analyse (re-générable à la demande)
- **Coût maîtrisé** : pas d'appel auto à l'ouverture — l'utilisateur clique pour déclencher la 1ère extraction. Si extrait déjà en cache, affichage instantané.
- **Pas de streaming** nécessaire (volumétrie courte, sortie structurée via tool calling)
- **Limites** : taille max fichier déjà gérée côté upload ; on documente que Mistral OCR supporte PDF/PPTX/DOCX/PNG/JPG

### Fichiers créés/modifiés
- `supabase/migrations/<timestamp>_courier_analysis.sql` (nouveau)
- `supabase/functions/analyze-courier/index.ts` (nouveau)
- `src/services/courierAnalysisService.ts` (nouveau)
- `src/components/courier/ContentIntentsTab.tsx` (nouveau)
- `src/components/courier/MailboxSidePanel.tsx` (modifié — remplacer placeholder)

### Question avant de coder
Préfères-tu un **déclenchement automatique** au 1er affichage de l'onglet (UX fluide, coût immédiat) ou **manuel** via boutons "Extraire" / "Analyser" (coût maîtrisé) ? Ma reco : **manuel** pour l'OCR (coût Mistral OCR par page) et **manuel** pour l'analyse, avec re-affichage instantané du cache à la prochaine ouverture.
