## Problème

Dans `src/components/NotificationBell.tsx`, la liste des notifications utilise `<ScrollArea className="max-h-[360px]">`. Or le `Viewport` interne de Radix ScrollArea est en `h-full` : sans hauteur définie sur le Root (seulement `max-height`), le viewport ne calcule pas correctement sa hauteur et le scroll n'est jamais activé — la liste déborde simplement du popover.

## Correctif

Dans `src/components/NotificationBell.tsx` :

- Remplacer `<ScrollArea className="max-h-[360px]">` par `<ScrollArea className="h-[360px]">` afin que le viewport interne ait une hauteur effective et active le scroll vertical dès que les notifications dépassent.
- (Optionnel) Ajuster légèrement à `h-[60vh] max-h-[420px]` pour mieux s'adapter aux petits écrans, tout en gardant un comportement scrollable garanti.

Aucune autre modification nécessaire — le composant `ScrollArea` shadcn gère déjà la scrollbar.