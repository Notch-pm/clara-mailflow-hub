-- Canal « Relayé agent » et idempotence des dépôts d'Iris (2026-10-10).
--
-- Un agent d'Iris (gestion des demandes d'usagers) saisit une « demande
-- complexe » — un texte collé, des fichiers — qu'il ne sait pas rattacher à une
-- démarche : Iris ne la conserve pas, il la RELAIE à Clara pour analyse
-- (edge function `iris-courrier`). Le courrier arrive sur ce canal, comme
-- `relaye_elu` pour l'espace élu.
--
-- Valeur seulement ajoutée : `stats_by_channel` et `search_couriers` lisent le
-- canal en texte, rien d'autre en base ne l'énumère. Rejouable (IF NOT EXISTS).
ALTER TYPE public.courier_channel ADD VALUE IF NOT EXISTS 'relaye_agent';

-- Iris relaie chaque dépôt avec un `submission_id` tiré à l'ouverture du
-- formulaire : un rejeu (réseau, double clic) rend le MÊME courrier. Même parti
-- que `couriers_nora_submission_uniq` : l'index tranche la course entre deux
-- rejeux simultanés, et ne pèse que sur les courriers venus d'Iris.
create unique index if not exists couriers_iris_submission_uniq
  on public.couriers (organization_id, (metadata->>'iris_submission_id'))
  where metadata ? 'iris_submission_id';
