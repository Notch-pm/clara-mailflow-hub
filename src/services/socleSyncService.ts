import { supabase } from "@/integrations/supabase/client";

// Synchronisation du référentiel Socle (source de vérité des démarches).
// Lecture des miroirs + déclenchement manuel de la sync via l'edge function.

export interface SocleCategory {
  id: string;
  organization_id: string;
  socle_id: string;
  name: string;
  icon: string | null;
  synced_at: string;
  obsoleted_at: string | null;
}

export interface SocleSyncRun {
  id: string;
  organization_id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "error";
  dry_run: boolean;
  counters: SocleSyncCounters | null;
  error: string | null;
}

export interface SocleEntityCounters {
  created: number;
  updated: number;
  adopted: number;
  obsoleted: number;
  unchanged: number;
}

export interface SocleSyncCounters {
  organizations: SocleEntityCounters;
  categories: SocleEntityCounters;
  document_types: SocleEntityCounters;
  procedures: SocleEntityCounters;
}

/** Ligne du miroir socle_organizations (hiérarchie importée du Socle). */
export interface SocleOrgMirror {
  id: string;
  organization_id: string;
  socle_id: string;
  socle_parent_id: string | null;
  name: string;
  slug: string | null;
  type: string | null;
  status: string; // active | obsolete (statut Socle)
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_url: string | null;
  synced_at: string;
  obsoleted_at: string | null;
}

export interface SocleOrganization {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string | null;
  type: string | null;
  status: string;
}

export interface SocleSyncResult {
  message: string;
  dry_run?: boolean;
  results?: Array<{
    organization_id: string;
    organization_name: string;
    status: "success" | "error";
    counters?: SocleSyncCounters;
    warnings?: string[];
    error?: string;
  }>;
}

export async function listSocleCategories(orgId: string): Promise<SocleCategory[]> {
  const { data, error } = await supabase
    .from("socle_categories")
    .select("*")
    .eq("organization_id", orgId)
    .is("obsoleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as SocleCategory[];
}

/** Miroir des (sous-)organisations du tenant — obsolètes incluses (badge dans l'UI). */
export async function listSocleOrganizationTree(orgId: string): Promise<SocleOrgMirror[]> {
  const { data, error } = await supabase
    .from("socle_organizations")
    .select("*")
    .eq("organization_id", orgId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as SocleOrgMirror[];
}

export async function getLastSyncRun(orgId: string): Promise<SocleSyncRun | null> {
  const { data, error } = await supabase
    .from("socle_sync_runs")
    .select("*")
    .eq("organization_id", orgId)
    .eq("dry_run", false)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as SocleSyncRun | null;
}

/** Déclenche une synchronisation manuelle (synchrone : la réponse contient les compteurs). */
export async function triggerSocleSync(
  orgId: string,
  options: { dryRun?: boolean } = {},
): Promise<SocleSyncResult> {
  const { data, error } = await supabase.functions.invoke("sync-socle-referentiel", {
    body: {
      organization_id: orgId,
      background: false,
      dry_run: options.dryRun === true,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as SocleSyncResult;
}

/** Liste les organisations du Socle (superadmin — pour le mapping socle_org_id). */
export async function listSocleOrganizations(): Promise<SocleOrganization[]> {
  const { data, error } = await supabase.functions.invoke(
    "sync-socle-referentiel?action=list-organizations",
    { body: {} },
  );
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return (data?.organizations ?? []) as SocleOrganization[];
}
