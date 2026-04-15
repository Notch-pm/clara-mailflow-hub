INSERT INTO public.users (id, email, is_superadmin, is_active)
VALUES ('ae656796-eb05-495a-8ea7-1c3bf102d77b', 'jacquotlaurent@ik.me', true, true)
ON CONFLICT (id) DO UPDATE SET is_superadmin = true;