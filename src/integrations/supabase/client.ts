import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

/**
 * The current organization ID injected as `x-org-id` header on every
 * Supabase request so that PostgREST RLS policies can read it via
 * `current_setting('request.header.x-org-id', true)`.
 */
let _orgId: string | null = null;

export function setOrganizationId(orgId: string | null) {
  _orgId = orgId;
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
  global: {
    fetch: (input, init) => {
      init = init ?? {};
      const headers = new Headers(init.headers);
      if (_orgId) {
        headers.set('x-org-id', _orgId);
      }
      init.headers = headers;
      return fetch(input, init);
    },
  },
});
