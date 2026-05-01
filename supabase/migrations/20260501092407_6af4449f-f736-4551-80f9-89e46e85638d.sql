UPDATE public.workflow_states ws
SET name = 'En cours'
FROM public.workflows w
WHERE ws.workflow_id = w.id
  AND w.type = 'reply'
  AND ws.name = 'En cours de rédaction';