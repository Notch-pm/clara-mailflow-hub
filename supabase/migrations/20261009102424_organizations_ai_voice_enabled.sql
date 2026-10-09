-- Dictée vocale d'un courrier (2026-10-09) : miroir du drapeau « voix ouverte »
-- du Socle (`GET /v1/organizations/{id}/assistant` → `voice_enabled`,
-- public-api 1.39.0), recopié par `sync-socle-referentiel`.
--
-- La collectivité ouvre la voix au Socle, parce que la transcription se paie
-- sur son crédit IA. Clara n'en tient qu'un miroir : l'écran l'utilise pour
-- afficher le micro, `transcribe-dictation` le RELIT avant chaque appel.
--
-- ⚠️ AUCUN GRANT UPDATE pour `authenticated` : les droits d'écriture sur
-- `organizations` sont posés colonne par colonne depuis le 2026-09-13 (aucun
-- UPDATE de table), donc une colonne nouvelle n'est modifiable par aucun client.
-- Seule la sync (service_role) l'écrit. Ne pas l'ajouter à la liste.
alter table public.organizations
  add column if not exists ai_voice_enabled boolean not null default false;

comment on column public.organizations.ai_voice_enabled is
  'Miroir de assistant.voice_enabled du Socle (dictée vocale ouverte). Écrit uniquement par sync-socle-referentiel.';
