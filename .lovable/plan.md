

# Plan: Clara -- SaaS de gestion du courrier administratif

## Vue d'ensemble

Construire l'application Clara en reprenant le design system et les composants de navigation de GFA-Ariane, puis structurer les services frontend (Supabase client-side) et les pages pour la gestion du courrier multi-tenant.

**Rappel**: pas de backend Node.js possible dans Lovable. Les "services backend" seront des modules TypeScript client-side qui encapsulent les requêtes Supabase, filtrées par `organization_id`.

---

## Etape 1 -- Design system et composants de navigation (depuis GFA-Ariane)

**Fichiers a modifier/creer:**

- `src/index.css` -- Reprendre la palette Notch (vert/jaune), la font Nunito Sans, les ombres Airbnb, les utilitaires compact mode
- `tailwind.config.ts` -- Ajouter fontFamily, `success`/`warning` colors, `boxShadow` airbnb, animation `pulse-soft`
- `src/components/NavLink.tsx` -- Remplacer par la version GFA-Ariane (avec `activeClassName`)
- `src/components/AppLayout.tsx` -- Layout principal (header + sidebar + outlet + mobile nav), adapte pour Clara (sans org color injection pour l'instant)
- `src/components/AppHeader.tsx` -- Header avec logo "Clara", profil dropdown (simplifie, sans sites)
- `src/components/AppSidebar.tsx` -- Sidebar avec icones Lucide (Mail, MailOpen, Link, GitBranch, Send) pour les sections Clara
- `src/components/MobileNav.tsx` -- Navigation mobile bottom bar

**Assets**: Utiliser des icones Lucide plutot que copier les SVG specifiques a Ariane (non pertinents pour le courrier).

## Etape 2 -- Services (modules Supabase client-side)

Chaque service encapsule les operations CRUD filtrees par `organization_id`.

- `src/services/courierService.ts` -- CRUD couriers (entrants/sortants), filtrage par type/status
- `src/services/courierParticipantService.ts` -- Gestion des participants (expediteur, destinataire)
- `src/services/courierDocumentService.ts` -- Upload/liste des documents lies
- `src/services/courierEventService.ts` -- Historique des evenements (creation, transition, commentaire)
- `src/services/courierLinkService.ts` -- Liaison avec tickets externes
- `src/services/workflowService.ts` -- Lecture des workflows, etats, transitions
- `src/services/courierSequenceService.ts` -- Generation de numeros de reference

**Pattern commun:**
```typescript
export async function getCouriers(organizationId: string, filters?) {
  const query = supabase
    .from('couriers')
    .select('*, courier_participants(*), courier_documents(*)')
    .eq('organization_id', organizationId);
  // appliquer filtres...
  return query;
}
```

## Etape 3 -- Types TypeScript

- `src/types/courier.ts` -- Interfaces pour toutes les tables (Courier, CourierParticipant, CourierDocument, CourierEvent, CourierLink, Workflow, WorkflowState, WorkflowTransition, CourierSequence)

## Etape 4 -- Pages et routes

- `src/pages/Dashboard.tsx` -- Tableau de bord (compteurs courriers entrants/sortants, recents)
- `src/pages/CourriersEntrants.tsx` -- Liste des courriers entrants avec filtres
- `src/pages/CourriersSortants.tsx` -- Liste des courriers sortants
- `src/pages/CourierDetail.tsx` -- Detail d'un courrier (infos, participants, documents, evenements, liens)
- `src/pages/Workflows.tsx` -- Visualisation des workflows et etats
- `src/App.tsx` -- Mise a jour des routes avec AppLayout comme layout parent

## Etape 5 -- Contexte d'organisation

- `src/contexts/OrganizationContext.tsx` -- Fournit `organizationId` a toute l'app (pour le moment, valeur configurable ou depuis l'auth Supabase)

---

## Architecture des fichiers

```text
src/
  components/
    AppLayout.tsx
    AppHeader.tsx
    AppSidebar.tsx
    MobileNav.tsx
    NavLink.tsx
  contexts/
    OrganizationContext.tsx
  services/
    courierService.ts
    courierParticipantService.ts
    courierDocumentService.ts
    courierEventService.ts
    courierLinkService.ts
    workflowService.ts
    courierSequenceService.ts
  types/
    courier.ts
  pages/
    Dashboard.tsx
    CourriersEntrants.tsx
    CourriersSortants.tsx
    CourierDetail.tsx
    Workflows.tsx
```

## Contraintes respectees

- Aucune table creee, aucune migration
- Toutes les requetes filtrees par `organization_id`
- Relations FK utilisees dans les `select` Supabase
- Code modulaire et maintenable

