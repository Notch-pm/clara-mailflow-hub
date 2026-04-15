
-- Create user
INSERT INTO public.users (email, first_name, last_name, is_active)
VALUES ('jacquotlaurent@gmail.com', 'Laurent', 'Jacquot', true);

-- Link to organization with role administrateur
INSERT INTO public.organization_users (organization_id, user_id, role, is_active)
SELECT
  '55dab847-7a67-4fa2-b878-70c25338fc9e',
  u.id,
  'administrateur',
  true
FROM public.users u
WHERE u.email = 'jacquotlaurent@gmail.com';
