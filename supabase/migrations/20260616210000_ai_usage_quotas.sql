-- Système de quotas de consommation IA, générique multi-fournisseurs.
-- Trois tables :
--   ai_usage_quotas   : plafond configurable par organisation (et éventuellement
--                       par fournisseur — NULL = plafond global tous fournisseurs).
--   ai_usage_counters : compteurs vivants (consommé + réservé) par organisation,
--                       fournisseur et période ('YYYY-MM'). Le passage au mois
--                       suivant crée naturellement une nouvelle ligne — pas de
--                       job de reset destructif.
--   ai_usage_events   : ledger d'audit du cycle de vie de chaque appel IA
--                       (réservé -> complété/échoué/expiré).

CREATE TABLE public.ai_usage_quotas (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider              text NULL, -- NULL = plafond appliqué tous fournisseurs confondus
  period_unit           text NOT NULL DEFAULT 'month' CHECK (period_unit IN ('month')),
  monthly_limit_tokens  bigint NOT NULL CHECK (monthly_limit_tokens > 0),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider)
);

CREATE TABLE public.ai_usage_counters (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider          text NULL, -- même convention que ai_usage_quotas.provider (NULL = global)
  period            text NOT NULL, -- 'YYYY-MM' (chaîne générique pour permettre d'autres granularités plus tard)
  used_tokens       bigint NOT NULL DEFAULT 0 CHECK (used_tokens >= 0),
  reserved_tokens   bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, provider, period)
);

CREATE TABLE public.ai_usage_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider          text NOT NULL, -- toujours concret ici (ex. "mistral"), pour l'audit
  -- Clé provider du compteur effectivement réservé au moment de reserve_ai_usage
  -- (NULL si c'est le plafond global qui s'est appliqué). Fixée à la réservation
  -- et réutilisée telle quelle par settle_ai_usage, pour ne jamais dépendre d'une
  -- résolution a posteriori qui pourrait dériver si la config de quota change
  -- entre la réservation et le règlement.
  counter_provider  text NULL,
  resource_type     text NOT NULL CHECK (resource_type IN ('ocr', 'chat', 'agent')),
  status            text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'completed', 'failed', 'timeout')),
  estimated_tokens  bigint NOT NULL CHECK (estimated_tokens >= 0),
  actual_tokens     bigint NULL,
  period            text NOT NULL,
  created_by        uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  settled_at        timestamptz NULL
);

CREATE INDEX idx_ai_usage_events_org_period ON public.ai_usage_events (organization_id, period);
CREATE INDEX idx_ai_usage_events_stale_reserved ON public.ai_usage_events (status, created_at) WHERE status = 'reserved';
CREATE INDEX idx_ai_usage_counters_org_period ON public.ai_usage_counters (organization_id, period);

ALTER TABLE public.ai_usage_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

-- Lecture : tout membre de l'organisation (affichage consommation dans l'UI).
CREATE POLICY auth_select ON public.ai_usage_quotas FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));
CREATE POLICY auth_select ON public.ai_usage_counters FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));
CREATE POLICY auth_select ON public.ai_usage_events FOR SELECT TO authenticated
  USING (public.is_member_of(organization_id));

-- Écriture du plafond : superadmin uniquement (levier de maîtrise des coûts
-- Mistral côté Notch, pas un paramètre métier délégué aux admins d'organisation).
CREATE POLICY superadmin_write ON public.ai_usage_quotas FOR ALL TO authenticated
  USING (public.is_superadmin(auth.uid())) WITH CHECK (public.is_superadmin(auth.uid()));

-- Écriture des compteurs/ledger : edge functions uniquement (client admin/service_role).
-- Aucune policy authenticated en écriture sur ces deux tables.
CREATE POLICY service_role_full ON public.ai_usage_quotas FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_full ON public.ai_usage_counters FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_full ON public.ai_usage_events FOR ALL TO service_role USING (true) WITH CHECK (true);
