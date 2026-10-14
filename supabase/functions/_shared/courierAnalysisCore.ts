/**
 * Cœur de l'analyse IA d'un courrier, commun aux deux portes d'entrée :
 * - `analyze-courier` : un courrier déjà créé (fiche, file d'analyse) ;
 * - `extract-courier-info` : un courrier PAS ENCORE créé (écran de saisie,
 *   import en masse).
 *
 * Avant le 2026-10-14, l'écran de création faisait une analyse allégée (titre,
 * expéditeur, organisation, tags) puis la validation en relançait une complète
 * — OCR et IA payés deux fois. Désormais une seule analyse, celle-ci, produit
 * tout (résumé, classement, actions suggérées avec leur préremplissage), et
 * l'écran de création l'enregistre telle quelle sur le courrier.
 *
 * Ce module ne lit ni n'écrit le courrier : il reçoit le contenu, rend
 * l'analyse revalidée. L'appelant décide où la ranger.
 */
import {
  AGENT_EXTRACTION,
  AiQuotaExceededError,
  FEATURE_ANALYSIS,
  FEATURE_PREFILL,
  fitMessage,
  MAX_OUTPUT_TOKENS,
  parseJsonAnswer,
  socleCompletion,
  type SocleAiContext,
} from "./socleAi.ts";
import { jsonSchemaInstruction, objectSchema } from "./jsonSchemaPrompt.ts";
import {
  SUGGESTED_FIELDS_PROPERTIES,
  SUGGESTED_FIELDS_KEYS,
  SUGGESTED_FIELDS_PROMPT_RULES,
  nullIfEmpty,
  cleanSenderFields,
} from "./courierFieldSuggestions.ts";
import {
  buildServiceCatalog,
  noServiceSuggestionNote,
  resolveSuggestedService,
  selectServiceCandidates,
  serviceSuggestionPromptRules,
  SERVICE_SUGGESTION_PROPERTY,
  type ServiceCandidate,
} from "./serviceSuggestion.ts";
import {
  attachPrefills,
  buildProcedureCatalog,
  planPrefillCalls,
  resolveSuggestedOrganization,
  sanitizePrefillArguments,
  selectPrefillCandidates,
  splitPrefillCall,
  type OrganizationRef,
  type PrefillCall,
  type PrefillProcedureSource,
  type ProcedureCatalogEntry,
  type SanitizedPrefill,
} from "../analyze-courier/logic.ts";

// deno-lint-ignore no-explicit-any
type AdminClient = any;

/** Ce qu'on donne à lire au modèle. */
export interface AnalysisContent {
  /** Objet saisi, s'il y en a un (absent à la création). */
  subject: string | null;
  /** Corps d'email, ou texte collé / dicté. */
  body: string;
  /** Texte extrait des pièces, déjà concaténé. */
  attachmentsText: string;
  /** Le texte est la transcription d'une dictée : l'expéditeur est l'usager dont parle le locuteur. */
  fromDictation?: boolean;
}

export interface CourierAnalysisOptions {
  /** Organisation déjà désignée : gardée au catalogue, pour que le modèle puisse la confirmer. */
  currentServiceOrgId?: string | null;
  /** Imputation de la dépense ; `feature` est fixée ici, appel par appel. */
  ctx: SocleAiContext;
}

/** L'analyse revalidée : tout identifiant appartient à l'organisation. */
export interface CourierAnalysisResult {
  summary: string | null;
  /** Thèmes puis sentiments, en UNE liste de noms de tags de l'organisation. */
  intents: string[];
  suggested_actions: Array<{
    label: string;
    procedure_id: string | null;
    procedure_name: string | null;
    socle_organization_id: string | null;
    socle_organization_name: string | null;
    prefill: Record<string, string>;
    socle_prefill?: unknown;
    arpege_prefill?: unknown;
  }>;
  suggested_subject: string | null;
  suggested_recipient_name: string | null;
  sender: ReturnType<typeof cleanSenderFields>;
  service: ReturnType<typeof resolveSuggestedService>;
  /** Sans proposition d'organisation : pourquoi. */
  service_note: string | null;
}

const DICTATION_RULES = `
Ce texte est la TRANSCRIPTION d'une dictée vocale, pas un courrier écrit :
- Il peut contenir des hésitations, des répétitions, des reprises et des fautes de transcription (noms propres approximatifs) : comprends l'intention, ignore le bruit.
- Le locuteur est un agent ou un élu de la collectivité qui RAPPORTE la demande d'un usager. L'expéditeur (sender_*) est l'USAGER dont il parle, jamais le locuteur. Si aucun usager n'est nommé, laisse les champs sender_* à null.
- Une adresse e-mail ou un numéro de téléphone dictés peuvent être épelés (« dupont arobase gmail point com », « zéro six douze… ») : restitue-les sous leur forme écrite.
- suggested_subject : reformule la demande en un objet court et factuel (pas « Dictée » ni « Appel »).
- recipient_name : null, sauf si le locuteur nomme explicitement un destinataire.`;

export async function runCourierAnalysis(
  admin: AdminClient,
  orgId: string,
  content: AnalysisContent,
  { currentServiceOrgId = null, ctx }: CourierAnalysisOptions,
): Promise<CourierAnalysisResult> {
  const body = content.body.trim().slice(0, 30_000);
  const attachments = content.attachmentsText.trim().slice(0, 60_000);
  if (!body && !attachments) {
    throw new Error("Aucun contenu à analyser. Lancez d'abord l'extraction OCR ou ajoutez un corps d'email.");
  }

  // Tags disponibles dans l'organisation — le LLM ne peut choisir QUE parmi
  // ceux-ci, et EN DEUX LISTES : le thème dit de quoi parle le courrier, le
  // sentiment sur quel ton. Mêlés, le modèle en choisissait cinq du même bord.
  const { data: orgTags } = await admin
    .from("courier_tags")
    .select("name, tag_group")
    .eq("organization_id", orgId);
  const tagRows = (orgTags ?? []) as Array<{ name: string; tag_group: string }>;
  const namesOfGroup = (group: string) =>
    tagRows
      .filter((t) => (t.tag_group ?? "theme") === group)
      .map((t) => t.name)
      .filter((n) => typeof n === "string" && n.trim().length > 0);
  const themeTagNames = namesOfGroup("theme");
  const sentimentTagNames = namesOfGroup("sentiment");

  // Démarches disponibles — données Socle incluses : descriptions/mots-clés
  // pour la pertinence des recommandations, form_schema/knowledge_base pour
  // l'appel de préremplissage ciblé.
  const { data: orgProcedures } = await admin
    .from("procedures")
    .select(
      "id, name, external_source, external_reference_id, arpege_config_fields, keywords, agent_description, description, form_schema, knowledge_base",
    )
    .eq("organization_id", orgId)
    .eq("is_displayed", true)
    .is("obsoleted_at", null) // exclut les démarches retirées du Socle (soft-delete)
    .order("display_order", { ascending: true });
  const procedureList = (orgProcedures ?? []) as Array<ProcedureCatalogEntry & PrefillProcedureSource>;

  // Organisations disponibles (miroir Socle) : destinataires des démarches, et
  // catalogue décrit pour proposer le service instructeur.
  const { data: socleOrgRows } = await admin
    .from("socle_organizations")
    .select("id, name, socle_id, socle_parent_id, public_description, attributions, workflow_id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .is("obsoleted_at", null);

  // Qui assure quoi (miroir `procedure_organizations`) : le modèle doit choisir
  // l'organisation DANS cette liste, sans quoi Iris refuse le dépôt.
  const knownOrgs = new Map<string, OrganizationRef>(
    (socleOrgRows ?? []).map((o: OrganizationRef) => [o.id, { id: o.id, name: o.name }]),
  );
  const { data: activationRows } = await admin
    .from("procedure_organizations")
    .select("procedure_id, socle_organization_id")
    .eq("organization_id", orgId)
    .is("obsoleted_at", null);
  const orgsByProcedure = new Map<string, OrganizationRef[]>();
  for (const row of (activationRows ?? []) as Array<{ procedure_id: string; socle_organization_id: string }>) {
    const org = knownOrgs.get(row.socle_organization_id);
    if (!org) continue; // organisation obsolète : plus proposable
    const list = orgsByProcedure.get(row.procedure_id) ?? [];
    list.push(org);
    orgsByProcedure.set(row.procedure_id, list);
  }
  for (const proc of procedureList) {
    proc.organizations = orgsByProcedure.get(proc.id) ?? [];
  }

  // Service instructeur : le catalogue dit ce que fait chaque organisation
  // (descriptif du Socle + démarches qu'elle instruit). L'organisation déjà
  // désignée y reste toujours, pour que le modèle puisse la confirmer.
  const allServiceOrgs = (socleOrgRows ?? []) as ServiceCandidate[];
  const currentServiceOrg = allServiceOrgs.find((o) => o.id === currentServiceOrgId) ?? null;
  const serviceCandidates = selectServiceCandidates(allServiceOrgs);
  if (currentServiceOrg && !serviceCandidates.some((o) => o.id === currentServiceOrg.id)) {
    serviceCandidates.push(currentServiceOrg);
  }
  const procedureNamesByOrg = new Map<string, string[]>();
  for (const proc of procedureList) {
    for (const o of proc.organizations ?? []) {
      const list = procedureNamesByOrg.get(o.id) ?? [];
      list.push(proc.name);
      procedureNamesByOrg.set(o.id, list);
    }
  }
  const serviceCatalogForPrompt = buildServiceCatalog(serviceCandidates, procedureNamesByOrg, allServiceOrgs);

  const listForPrompt = (names: string[], empty: string) =>
    names.length > 0 ? names.map((n) => `- ${n}`).join("\n") : empty;
  const themeListForPrompt = listForPrompt(themeTagNames, "(aucun thème défini — laisse intents vide)");
  const sentimentListForPrompt = listForPrompt(
    sentimentTagNames,
    "(aucun sentiment défini — laisse sentiments vide)",
  );
  const procedureListForPrompt = buildProcedureCatalog(procedureList);

  const systemPrompt = `Tu es un assistant expert en gestion de courrier administratif. Analyse le contenu fourni et restitue les éléments suivants :
- summary: résumé concis (2-3 phrases) du contenu
- intents: les THÈMES du courrier — de quoi il parle. Choisis EXCLUSIVEMENT dans la liste des thèmes disponibles ci-dessous (copie exacte du nom, sensible à la casse). N'invente AUCUN tag. Si aucun ne s'applique, renvoie une liste vide.
- sentiments: le TON du rédacteur. Choisis EXCLUSIVEMENT dans la liste des sentiments disponibles ci-dessous (copie exacte du nom). En règle générale UN SEUL suffit, deux au maximum quand le courrier est franchement partagé. Liste vide si le ton n'est pas lisible.
- suggested_actions: 2 à 5 actions concrètes que l'organisation devrait entreprendre. Pour chaque action :
  • label: description courte de l'action
  • procedure_id: si une démarche de la liste correspond réellement à l'action (vérifie la cohérence avec sa description et ses mots-clés, pas seulement son nom), indique son id exact. Sinon null. Ne force jamais une correspondance approximative.
  • socle_organization_id: organisation à qui adresser la demande. Choisis-la EXCLUSIVEMENT parmi celles listées après « assurée par » sur la démarche retenue (copie l'id exact indiqué par « [org: … ] »), en te fondant sur le lieu ou le service concerné par le courrier. Si aucune ne s'impose, ou si l'action ne porte aucune démarche, renvoie null. N'invente jamais d'organisation.
  • prefill: si des données personnelles sont identifiables dans le courrier (nom, prénom, email, téléphone, date de naissance, civilité), extrais-les ici pour pré-remplir le formulaire. N'invente aucune donnée absente du courrier.
${SUGGESTED_FIELDS_PROMPT_RULES}
${serviceSuggestionPromptRules(currentServiceOrg ? { id: currentServiceOrg.id, name: currentServiceOrg.name } : null)}
Sois factuel, en français. Si le corps de l'email et les pièces jointes coexistent, traite-les comme un tout cohérent. Ne retourne que ce qui est clairement identifiable — ne devine rien.${content.fromDictation ? DICTATION_RULES : ""}

Thèmes disponibles pour intents :
${themeListForPrompt}

Sentiments disponibles pour sentiments :
${sentimentListForPrompt}

Procédures disponibles (utilise l'id exact pour procedure_id) :
${procedureListForPrompt}

Organisations (catalogue pour suggested_service) :
${serviceCatalogForPrompt}`;

  const sections: string[] = [`Sujet du courrier : ${content.subject?.trim() || "(aucun)"}`];
  if (body) {
    sections.push(`${content.fromDictation ? "Transcription de la dictée" : "Corps de l'email"} :\n${body}`);
  }
  if (attachments) {
    sections.push(`Contenu extrait des pièces jointes :\n${attachments}`);
  }
  const userPrompt = sections.join("\n\n");

  const namesSchema = (names: string[]): Record<string, unknown> => ({
    type: "array",
    items: names.length > 0 ? { type: "string", enum: names } : { type: "string" },
  });

  // ⚠️ CE SCHÉMA VIVAIT DANS `tools`. Il n'a pas disparu avec la
  // centralisation : il a changé de place. Le guichet du Socle refuse
  // `tools`/`tool_choice` par principe et n'offre que « du JSON valide » —
  // la conformité au schéma reste donc l'affaire de Clara. Les revalidations
  // qui suivent — tags de l'organisation, démarches existantes, organisation
  // proposée — sont et restent la vraie défense.
  const analysisSchema = objectSchema(
    {
      summary: { type: "string" },
      intents: namesSchema(themeTagNames),
      sentiments: namesSchema(sentimentTagNames),
      ...SUGGESTED_FIELDS_PROPERTIES,
      ...SERVICE_SUGGESTION_PROPERTY,
      suggested_actions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Action concrète à entreprendre" },
            procedure_id: { type: ["string", "null"], description: "ID exact de la procédure correspondante, ou null" },
            socle_organization_id: {
              type: ["string", "null"],
              description: "ID exact de l'organisation qui assure cette démarche, ou null",
            },
            prefill: {
              type: "object",
              description: "Données extractibles du courrier pour pré-remplir le formulaire demandeur",
              properties: {
                CIVILITE: { type: "string", enum: ["M", "MME", "MLLE"] },
                NOM_USUEL: { type: "string" },
                NOM_NAISSANCE: { type: "string" },
                PRENOMS: { type: "string" },
                DATE_NAISSANCE: { type: "string", description: "Format YYYY-MM-DD" },
                EMAIL: { type: "string" },
                TEL_FIXE: { type: "string" },
                TEL_MOBILE: { type: "string" },
              },
              additionalProperties: false,
            },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
    },
    ["summary", "intents", "sentiments", "suggested_actions", "suggested_service", ...SUGGESTED_FIELDS_KEYS],
  );

  type ParsedAnalysis = {
    summary: string;
    intents: string[];
    sentiments: string[];
    suggested_actions: Array<{
      label: string;
      procedure_id?: string | null;
      socle_organization_id?: string | null;
      prefill?: Record<string, string>;
    }>;
    suggested_subject?: string;
    suggested_service?: unknown;
    recipient_name?: string;
    sender_civility?: string;
    sender_first_name?: string;
    sender_last_name?: string;
    sender_email?: string;
    sender_phone?: string;
  };

  const analysisAnswer = await socleCompletion({
    system: `${systemPrompt}

${jsonSchemaInstruction(analysisSchema)}`,
    messages: [{ role: "user", content: fitMessage(userPrompt) }],
    agent: AGENT_EXTRACTION,
    // ⚠️ LE PLAFOND DE SORTIE, ET NON UNE ESTIMATION SERRÉE. Règle maison pour
    // tout appel `json: true` : une réponse JSON tronquée est une PERTE TOTALE
    // (elle ne parse pas, tout l'appel est à rejouer), tandis qu'une
    // réservation trop haute est rendue au règlement — le Socle solde sur la
    // consommation réelle. Les deux risques ne sont pas du même ordre.
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    json: true,
    ctx: { ...ctx, feature: FEATURE_ANALYSIS },
  });
  const parsed = parseJsonAnswer<ParsedAnalysis>(analysisAnswer);

  // Sécurité : ne garder que les tags qui appartiennent bien à l'organisation,
  // ET AU BON GROUPE — un modèle à qui l'on donne deux listes range parfois un
  // sentiment dans les thèmes. Mapping strict, insensible à la casse.
  const keepFrom = (names: string[], proposed: unknown): string[] => {
    const allowed = new Set(names.map((n) => n.toLowerCase()));
    return Array.isArray(proposed)
      ? proposed.filter((i): i is string => typeof i === "string" && allowed.has(i.toLowerCase()))
      : [];
  };
  // Les deux groupes se rejoignent dans UNE liste : ce qui est appliqué au
  // courrier est une liste de noms, le groupe se relit dans le référentiel.
  const safeIntents = [
    ...keepFrom(themeTagNames, parsed.intents),
    ...keepFrom(sentimentTagNames, parsed.sentiments),
  ];

  // Sécurité : s'assurer que les procedure_id retournés par le LLM appartiennent bien à l'org
  const validProcedureIds = new Set(procedureList.map((p) => p.id));
  const procedureById = new Map(procedureList.map((p) => [p.id, p.name]));
  const safeActions = Array.isArray(parsed.suggested_actions)
    ? parsed.suggested_actions.map((a) => {
        const validId = a.procedure_id && validProcedureIds.has(a.procedure_id) ? a.procedure_id : null;
        // Organisation destinataire : revalidée contre le miroir d'activation,
        // et imposée d'office quand une seule organisation assure la démarche.
        const org = resolveSuggestedOrganization(
          a.socle_organization_id,
          validId ? (orgsByProcedure.get(validId) ?? []) : [],
          knownOrgs,
        );
        return {
          label: a.label ?? "",
          procedure_id: validId,
          procedure_name: validId ? (procedureById.get(validId) ?? null) : null,
          socle_organization_id: org?.id ?? null,
          socle_organization_name: org?.name ?? null,
          prefill: a.prefill ?? {},
        };
      })
    : [];

  // ── Appel(s) 2 (ciblés, non bloquants) : préremplissage des démarches Socle ──
  // Pour les démarches recommandées ayant des champs de formulaire : form_schema
  // pour une démarche Iris, FormComponents pour une démarche Arpège (rangés en
  // `arpege_prefill`, par DataId). Le schéma de sortie est généré depuis ces champs
  // (labels et options portés par le schéma, pas de rappel dans le prompt) et
  // joint au prompt système depuis la centralisation IA ; au-delà
  // d'un seuil de taille, la planification scinde en un appel par démarche, et
  // un appel groupé qui échoue est rejoué scindé. La sortie est revalidée avant
  // stockage. En cas d'échec final, l'analyse est rendue sans socle_prefill.
  let actionsToStore: CourierAnalysisResult["suggested_actions"] = safeActions;
  const prefillCandidates = selectPrefillCandidates(safeActions, procedureList);
  const prefillQueue: PrefillCall[] = planPrefillCalls(prefillCandidates);
  if (prefillQueue.length > 1) {
    console.warn(`report_prefill: schéma trop large — scission en ${prefillQueue.length} appels`);
  }

  const runPrefillCall = async (call: PrefillCall): Promise<unknown> => {
    const prefillSystemPrompt = `Tu prépares le préremplissage de formulaires de démarches administratives à partir du contenu d'un courrier.
Pour chaque démarche :
- audience : nature du demandeur (citoyen, entreprise ou association) si elle est claire d'après le courrier, sinon chaîne vide.
- form : pour chaque champ, la valeur extraite du courrier. N'invente RIEN : chaîne vide (ou tableau vide) pour tout champ dont la valeur n'est pas clairement présente. Champs à options : le CODE exact, jamais le libellé. Dates au format YYYY-MM-DD.
Appuie-toi sur les connaissances fournies pour interpréter les champs, et respecte les garde-fous.

${call.tool.promptBlock}

${jsonSchemaInstruction(call.tool.toolParameters as Record<string, unknown>)}`;
    const prefillUserPrompt = userPrompt.slice(0, call.contentMax);

    const answer = await socleCompletion({
      system: prefillSystemPrompt,
      messages: [{ role: "user", content: fitMessage(prefillUserPrompt) }],
      agent: AGENT_EXTRACTION,
      // Le plafond, pour la même raison que l'analyse ci-dessus.
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      json: true,
      ctx: { ...ctx, feature: FEATURE_PREFILL },
    });
    return parseJsonAnswer<unknown>(answer);
  };

  const sanitizedAll: Record<string, SanitizedPrefill> = {};
  while (prefillQueue.length > 0) {
    const call = prefillQueue.shift()!;
    try {
      const rawPrefill = await runPrefillCall(call);
      Object.assign(sanitizedAll, sanitizePrefillArguments(rawPrefill, call.procedures));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof AiQuotaExceededError) {
        console.warn("report_prefill interrompu (quota IA atteint):", msg);
        break;
      }
      const split = splitPrefillCall(call);
      if (split.length > 0) {
        console.warn(`report_prefill groupé échoué — repli en ${split.length} appels scindés:`, msg);
        prefillQueue.push(...split);
      } else {
        console.warn("report_prefill échoué (non bloquant):", msg);
      }
    }
  }
  if (Object.keys(sanitizedAll).length > 0) {
    actionsToStore = attachPrefills(safeActions, sanitizedAll, prefillCandidates);
  }

  // Sécurité : le service proposé doit appartenir au catalogue (id revalidé).
  const service = resolveSuggestedService(parsed.suggested_service, serviceCandidates);

  return {
    summary: nullIfEmpty(parsed.summary),
    intents: safeIntents,
    suggested_actions: actionsToStore,
    suggested_subject: nullIfEmpty(parsed.suggested_subject),
    suggested_recipient_name: nullIfEmpty(parsed.recipient_name),
    sender: cleanSenderFields(parsed),
    service,
    service_note: service ? null : noServiceSuggestionNote(parsed.suggested_service, serviceCandidates),
  };
}

/**
 * La ligne `courier_analyses` d'une analyse (hors `courier_id` et
 * `organization_id`). UNE forme pour les deux portes : `analyze-courier`
 * l'écrit lui-même, `extract-courier-info` la rend à l'écran de création, qui
 * l'écrit une fois le courrier créé.
 */
export function analysisRow(a: CourierAnalysisResult) {
  const sender = a.sender;
  const hasSender = !!(sender.first_name || sender.last_name || sender.email || sender.phone);
  return {
    summary: a.summary,
    intents: a.intents,
    // `sentiment` (colonne de l'ancien champ figé) n'est plus écrite depuis
    // le 2026-09-10 : le sentiment est un tag, rangé dans `intents`.
    suggested_actions: a.suggested_actions,
    suggested_subject: a.suggested_subject,
    // Le nom reste écrit pour l'existant ; l'identifiant et la raison
    // portent la proposition depuis le 2026-10-01.
    suggested_service_name: a.service?.name ?? null,
    suggested_socle_organization_id: a.service?.id ?? null,
    suggested_service_reason: a.service?.reason ?? null,
    // Confiance et alternatives (2026-10-01) : l'écran « Courrier entrant »
    // en tire « À valider » / « À qualifier » et le routage en lot ≥ 90 %.
    suggested_service_confidence: a.service?.confidence ?? null,
    suggested_service_alternatives: a.service?.alternativeIds ?? [],
    suggested_recipient_name: a.suggested_recipient_name,
    suggested_sender: hasSender ? sender : null,
    // ⚠️ NI MODÈLE NI JETONS : Clara ne les connaît plus, et c'est voulu. Le
    // modèle est choisi par le Socle derrière un alias, et le décompte vit dans
    // son journal (`ai_usage_events`). Recopier ici un nombre approché créerait
    // le second compteur que la centralisation a supprimé.
    model: "socle:ai-api",
    tokens_used: null,
  };
}

export type AnalysisRow = ReturnType<typeof analysisRow>;
