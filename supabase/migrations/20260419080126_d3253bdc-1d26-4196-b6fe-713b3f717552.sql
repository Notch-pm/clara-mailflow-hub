-- 1. Add assignee_id to action_tickets (user assigned to handle the ticket)
ALTER TABLE public.action_tickets
ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_action_tickets_assignee ON public.action_tickets(assignee_id);

-- 2. Add avatar_url to users
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS avatar_url text;

-- 3. Create user-avatars storage bucket (public for easy display)
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-avatars', 'user-avatars', true)
ON CONFLICT (id) DO NOTHING;

-- 4. Storage RLS policies for user-avatars bucket
-- Public read
CREATE POLICY "user_avatars_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'user-avatars');

-- Authenticated users can upload/update/delete avatars
-- (folder structure: <user_id>/<filename>)
CREATE POLICY "user_avatars_auth_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'user-avatars');

CREATE POLICY "user_avatars_auth_update"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'user-avatars');

CREATE POLICY "user_avatars_auth_delete"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'user-avatars');
