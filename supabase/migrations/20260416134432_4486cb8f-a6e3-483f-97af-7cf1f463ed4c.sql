
-- Fix ID mismatch: update users first, then organization_users
-- Temporarily defer FK check by disabling the trigger
SET session_replication_role = 'replica';

UPDATE public.users 
SET id = '2c940863-61fb-410e-8f9f-a7429631dc7c' 
WHERE id = '9c0f1a5a-75b5-4040-ae77-3713a2ee6868';

UPDATE public.organization_users 
SET user_id = '2c940863-61fb-410e-8f9f-a7429631dc7c' 
WHERE user_id = '9c0f1a5a-75b5-4040-ae77-3713a2ee6868';

SET session_replication_role = 'origin';
