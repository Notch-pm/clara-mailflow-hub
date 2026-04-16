---
name: RLS multi-tenant via request headers
description: All RLS policies use request.headers JSON to extract x-org-id, injected by Supabase client custom fetch
type: feature
---

## RLS Pattern

All tables use explicit per-command policies (SELECT/INSERT/UPDATE/DELETE) for `authenticated` role:
```sql
-- SELECT / UPDATE USING / DELETE USING:
USING (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid))

-- INSERT WITH CHECK / UPDATE WITH CHECK:
WITH CHECK (organization_id = ((current_setting('request.headers', true)::json ->> 'x-org-id')::uuid))
```

**Important:** Use `request.headers` (JSON object) not `request.header.x-org-id` (singular, unreliable in newer PostgREST).

Exception: `organizations` uses `id` instead of `organization_id`.

Legacy `org_isolation` policies (role `public`, using `request.header.x-org-id`) still exist but are superseded by the `authenticated` policies above.

## Client Integration

- `src/integrations/supabase/client.ts` exports `setOrganizationId(orgId)` 
- Custom `fetch` in Supabase client injects `x-org-id` header on every request
- `AuthContext` calls `setOrganizationId` after fetching membership
