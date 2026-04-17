

## Goal

1. Élargir la dialog "Nouveau courrier" et y intégrer un upload de fichiers (drag & drop + parcourir).
2. Élargir fortement le volet latéral et y intégrer la gestion des fichiers (ajout/suppression).
3. Ajouter une visionneuse intégrée dans le volet latéral pour PDF et images, avec navigation entre fichiers.

## Approach

### 1. `NewCourierDialog.tsx` — élargissement + upload de fichiers
- Passer `DialogContent` de `max-w-xl` à `max-w-4xl` (~896 px).
- Layout en 2 colonnes (`grid grid-cols-1 md:grid-cols-2 gap-6`) :
  - Colonne gauche : formulaire (objet, canal, date, expéditeur, destinataire, service, tags).
  - Colonne droite : zone de drop pour fichiers.
- Réutiliser la logique drag & drop de `DocumentManager` mais en mode "buffer" : tant que le courrier n'est pas créé, on stocke les `File[]` dans un state local `pendingFiles`. Affichage d'une liste compacte avec bouton retirer.
- Après `createCourier` réussi, boucler sur `pendingFiles` et appeler `storage.upload(orgId, courier.id, file, "attachment")` pour chaque fichier. Toaster en cas d'erreur partielle.
- Conserver le check de taille max (`storage.getMaxFileSize`).

### 2. `MailboxSidePanel.tsx` — élargissement + gestion + visionneuse
- Élargir `SheetContent` : `w-full sm:max-w-[90vw] lg:max-w-[1100px]` pour avoir la place d'un viewer.
- Layout interne en 2 colonnes via grid :
  - Gauche (`w-[360px] shrink-0`) : infos courrier, service, tags, actions workflow (contenu actuel).
  - Droite (flex-1) : nouvel encart "Documents" avec :
    - Liste verticale compacte des fichiers (vignette + nom + type + bouton supprimer).
    - Bouton/zone d'ajout (drag & drop + parcourir) réutilisant `storage.upload`.
    - Visionneuse au-dessus/à droite affichant le fichier sélectionné.
- Visionneuse :
  - Récupérer une URL signée via `storage.getSignedUrl(orgId, doc.storage_key)` à la sélection (mémorisée par `useQuery` keyed sur `doc.id`).
  - Si `mime_type` commence par `image/` → balise `<img>` `object-contain`.
  - Si `mime_type === "application/pdf"` → `<iframe src={url} />` plein hauteur.
  - Sinon → message "Aperçu non disponible — Télécharger".
  - Boutons Précédent / Suivant pour naviguer dans la liste, plus clic direct sur un item de la liste.
- Refactor : extraire la logique d'upload/listing/suppression de `DocumentManager` dans un nouveau composant léger `CourierDocumentsPanel` (ou réutiliser `DocumentManager` directement pour la zone d'upload + liste, et ajouter à côté un composant `DocumentViewer`). Préférence : créer `DocumentViewer.tsx` séparé et garder `DocumentManager` quasi intact mais avec une prop `onSelect(doc)` pour notifier le panel parent.

### 3. Nouveaux fichiers
- `src/components/courier/DocumentViewer.tsx` : visionneuse + navigation (props : `documents`, `currentId`, `onChange`, `organizationId`).

### 4. Fichiers modifiés
- `src/components/courier/NewCourierDialog.tsx` : largeur, layout 2 colonnes, upload différé.
- `src/components/courier/MailboxSidePanel.tsx` : largeur, layout 2 colonnes, intégration `DocumentManager` + `DocumentViewer`.
- `src/components/courier/DocumentManager.tsx` : ajout prop optionnelle `selectedDocId` + `onSelectDoc` pour piloter la sélection externe (pas de breaking change, props facultatives).

### Notes techniques
- Aucune migration DB nécessaire : tables `courier_documents`, bucket `clara-documents` et edge function `storage-documents` déjà en place.
- Les URLs signées sont éphémères : ne pas les persister, les regénérer via `useQuery` avec `staleTime` ~ 4 min.
- Sur mobile (<768 px), passer la dialog et le sheet en pleine largeur, la visionneuse passe sous la liste (stack vertical).

### ASCII layout cible — volet latéral

```text
┌─────────────────────────────────────────────────────────────────┐
│ Sujet du courrier                                          [X]  │
├──────────────────────┬──────────────────────────────────────────┤
│ Date / Canal         │  ┌─ Visionneuse ────────────────────┐    │
│ Destinataire         │  │                                  │    │
│ Expéditeur           │  │   PDF / image preview            │    │
│ ─────────            │  │                                  │    │
│ Service ▼            │  └──────────────────────────────────┘    │
│ Tags [ + ]           │  [◀ Préc]  fichier 2/5  [Suiv ▶]         │
│ ─────────            │  ─────────────────────────────────────   │
│ Actions workflow     │  Documents (liste + upload)              │
│ [Étape A] [Étape B]  │  • doc1.pdf       [👁] [⬇] [🗑]          │
│                      │  • photo.jpg      [👁] [⬇] [🗑]          │
│                      │  [Drop zone / Parcourir]                 │
└──────────────────────┴──────────────────────────────────────────┘
```

