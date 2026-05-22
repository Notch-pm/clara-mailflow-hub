-- Assure que les deux comptes email du superadmin ont bien le flag is_superadmin = true.
-- Le trigger prevent_superadmin_escalation bloque tout UPDATE de is_superadmin quand
-- auth.uid() est NULL (contexte migration). On le désactive le temps de l'opération.
ALTER TABLE public.users DISABLE TRIGGER users_prevent_superadmin_escalation;

UPDATE public.users
SET is_superadmin = true
WHERE email IN ('jacquotlaurent@ik.me', 'jacquotlaurent@gmail.com');

ALTER TABLE public.users ENABLE TRIGGER users_prevent_superadmin_escalation;
