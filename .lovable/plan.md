

## Problem

The `organization_users` table's RLS only allows access when the `x-org-id` header matches. During login, `AuthContext` fetches the user's membership **before** the org ID is known, so the header is empty and RLS blocks the read. Result: membership comes back null, and the user sees "Aucune organisation associee".

## Solution

Add an RLS policy on `organization_users` that lets authenticated users read their own rows (where `user_id = auth.uid()`), regardless of the `x-org-id` header. This is safe because users should always be able to discover which organizations they belong to.

## Changes

**1. Database migration — new RLS policy on `organization_users`**

```sql
CREATE POLICY "users_read_own_memberships"
  ON public.organization_users
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
```

No code changes needed — the existing `AuthContext` query will start returning data once the policy is in place.

## Why this is safe

- SELECT only — users cannot modify memberships
- Scoped to their own `user_id` — no access to other users' memberships
- Existing `org_isolation` and `superadmin` policies remain untouched

