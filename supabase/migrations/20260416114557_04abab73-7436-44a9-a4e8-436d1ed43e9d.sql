-- Drop FK constraint
ALTER TABLE public.organization_users DROP CONSTRAINT organization_users_user_id_fkey;

-- Update both tables
UPDATE public.organization_users
SET user_id = '2c940863-61fb-410e-8f9f-a7429631dc7c'
WHERE user_id = '60f62b59-f113-46cf-bd7b-078cd7aed875';

UPDATE public.users
SET id = '2c940863-61fb-410e-8f9f-a7429631dc7c'
WHERE id = '60f62b59-f113-46cf-bd7b-078cd7aed875';

-- Recreate FK
ALTER TABLE public.organization_users
  ADD CONSTRAINT organization_users_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
