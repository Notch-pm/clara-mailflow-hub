---
name: RLS multi-tenant via request headers
description: All RLS policies use request.header.x-org-id, injected by Supabase client custom fetch
type: feature
---

## RLS Pattern

All 10 tables use the same RLS policy pattern:
```sql
USING (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
WITH CHECK (organization_id = (current_setting('request.header.x-org-id', true))::uuid)
```

Exception: `organizations` uses `id` instead of `organization_id`.

## Client Integration

- `src/integrations/supabase/client.ts` exports `setOrganizationId(orgId)` 
- Custom `fetch` in Supabase client injects `x-org-id` header on every request
- `OrganizationContext` calls `setOrganizationId` and persists to localStorage
- Header selector in `AppHeader.tsx` allows switching org
