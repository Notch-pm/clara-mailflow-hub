

## Plan : Bypass OCR pour les documents textuels natifs

### Objectif
Pour les documents dont le texte est directement extractible (sans OCR), lire le contenu nativement et économiser des appels Mistral OCR.

### État actuel
Dans `analyze-courier/index.ts`, seul `text/*` (TXT, MD, CSV, JSON…) bypasse déjà l'OCR via `blob.text()`. Tous les autres formats (PDF, DOCX, etc.) passent par Mistral OCR — y compris les Word natifs dont le texte est pourtant directement extractible.

### Formats à traiter en natif (sans OCR)

| Format | MIME | Méthode d'extraction |
|---|---|---|
| TXT/MD/CSV/JSON | `text/*` | déjà géré (`blob.text()`) |
| **DOCX** | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | unzip + parse `word/document.xml` |
| **ODT** | `application/vnd.oasis.opendocument.text` | unzip + parse `content.xml` |
| **RTF** | `application/rtf`, `text/rtf` | strip des codes RTF (regex simple) |
| **PDF "texte"** | `application/pdf` | tentative d'extraction texte ; si vide ou trop court → fallback OCR Mistral |
| Images (JPG/PNG…) | `image/*` | OCR obligatoire (inchangé) |
| PDF scanné | `application/pdf` | fallback OCR (inchangé) |

### Implémentation (modification de `supabase/functions/analyze-courier/index.ts`)

Refactor de la fonction `ocrDocument` pour router selon le MIME :

1. **Branche `text/*`** → inchangée, modèle `direct-text`
2. **Nouvelle branche DOCX/ODT** : 
   - Télécharger le blob depuis Storage
   - Utiliser `JSZip` (via esm.sh) pour dézipper en mémoire
   - Extraire le XML cible (`word/document.xml` ou `content.xml`)
   - Strip des balises XML via regex pour récupérer le texte brut
   - Modèle stocké : `native-docx` ou `native-odt`
3. **Nouvelle branche RTF** : 
   - Télécharger le blob, lire en texte
   - Regex pour retirer les codes de contrôle RTF (`\\[a-z]+\d* ?`, accolades, etc.)
   - Modèle stocké : `native-rtf`
4. **Nouvelle branche PDF** :
   - Tenter d'abord une extraction texte native via une lib légère Deno (ex : `pdf-parse` via esm.sh, ou `unpdf`)
   - Si le texte extrait fait moins d'un seuil (ex : <50 caractères pour un PDF de plusieurs pages) → fallback OCR Mistral
   - Modèle stocké : `native-pdf` ou `mistral-ocr-latest` selon le chemin pris
5. **Branche par défaut (images, PDF scannés)** → OCR Mistral inchangé

### UI (`ContentIntentsTab.tsx`)
Léger ajustement du badge affiché : au lieu de toujours montrer "X p." ou "extrait", afficher la **méthode** ("natif", "OCR", "X p.") via `extract.model` pour rendre transparent le mode utilisé. Optionnel.

### Notes techniques
- **Pas de migration DB** : la colonne `model` existe déjà et accepte n'importe quelle string.
- **Pas de nouveaux secrets** : tout se fait côté edge function avec libs npm/esm.sh.
- **Économie** : DOCX/ODT/RTF/PDF-texte = 0 appel Mistral OCR. Coût uniquement pour images et scans.
- **Risque PDF** : certaines libs Deno-compatibles pour extraction PDF peuvent être lourdes ; je privilégierai `unpdf` (zéro dépendance, conçue pour Deno/serverless). Si extraction trop pauvre, fallback automatique sur Mistral.
- **Limites** : pas de support natif pour PPTX/XLSX dans cette itération (pourraient être ajoutés sur le même modèle si besoin).

### Fichiers modifiés
- `supabase/functions/analyze-courier/index.ts` (refactor `ocrDocument` + helpers `extractDocx`, `extractOdt`, `extractRtf`, `extractPdfNative`)
- `src/components/courier/ContentIntentsTab.tsx` (optionnel — affichage méthode dans le badge)

