
L'utilisateur a créé un agent Mistral pré-configuré (`ag_019d9b92d28872079534f45f246671ed`) et veut l'utiliser pour l'analyse, plutôt que d'appeler `mistral-large-latest` avec un prompt système défini côté code.

Mistral expose les agents via l'endpoint `https://api.mistral.ai/v1/agents/completions` qui accepte `agent_id` à la place de `model`. Le reste du payload (messages, tools, tool_choice) reste compatible.

## Plan

**Fichier à modifier** : `supabase/functions/analyze-courier/index.ts`

1. Ajouter une constante `MISTRAL_AGENT_URL = "https://api.mistral.ai/v1/agents/completions"` et `ANALYSIS_AGENT_ID = "ag_019d9b92d28872079534f45f246671ed"`.

2. Dans `analyzeCourier`, remplacer l'appel vers `MISTRAL_CHAT_URL` par un appel vers `MISTRAL_AGENT_URL` :
   - Body : `{ agent_id: ANALYSIS_AGENT_ID, messages, tools, tool_choice, temperature: 0.2 }` (pas de champ `model`).
   - Conserver les `tools` (schéma `report_analysis` avec enum dynamique des tags) et le `tool_choice` forcé pour garantir la sortie structurée — l'agent peut avoir son propre prompt mais on garde le contrat de sortie.

3. Garder le `systemPrompt` côté code en tant que message `system` : utile car la liste des tags disponibles est dynamique par organisation (l'agent ne peut pas la connaître à l'avance). L'agent enrichira/dirigera l'analyse, le système injectera les tags du tenant.

4. Enregistrer `model: ANALYSIS_AGENT_ID` (ou `agent:<id>`) dans `courier_analyses.model` pour traçabilité.

5. Conserver `OCR_MODEL` inchangé (l'agent ne fait pas d'OCR).

## Notes techniques
- L'API agents Mistral est compatible chat completions, donc le parsing de `tool_calls` reste identique.
- Si l'agent refuse `tools` ou `tool_choice`, on basculera sur le format `response_format: json_object`. À tester après déploiement.
- Aucune migration DB nécessaire.
