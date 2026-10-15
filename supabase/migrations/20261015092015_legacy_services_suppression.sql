-- Legacy Socle : suppression des services et du modèle de réponse Word (dette P2).
--
-- Les organisations du Socle ont remplacé les services le 2026-07-11 ; les
-- tables étaient gelées depuis, gardées pour un éventuel retour arrière. Au
-- 2026-10-15 plus rien ne les lit : aucun formulaire portail n'a de
-- `service_id`, toutes les boîtes IMAP sont rattachées à une organisation, et
-- les replis de `fetch-inbound-emails` / `portal-form` / `_shared/portalIntake`
-- ont été retirés.
--
-- ⚠️ À appliquer APRÈS le déploiement de `portal-form` sans `service_id` :
-- l'ancienne version sélectionne la colonne, et sa disparition ferait répondre
-- « Formulaire introuvable » à tout le portail.
--
-- `organizations.reply_template_data` (modèle .docx de l'ancien import) n'a
-- plus ni lecteur ni écrivain depuis le 2026-10-14.
--
-- `couriers.metadata.service_id` (35 courriers, tous avec un
-- `socle_organization_id`) n'est lu par personne mais n'est pas effacé : un
-- UPDATE de masse relancerait `updated_at`, donc l'horloge de rétention.

ALTER TABLE public.portal_forms DROP COLUMN IF EXISTS service_id;

DROP TABLE IF EXISTS public.service_signatories;
DROP TABLE IF EXISTS public.service_members;
DROP TABLE IF EXISTS public.services;

ALTER TABLE public.organizations DROP COLUMN IF EXISTS reply_template_data;
