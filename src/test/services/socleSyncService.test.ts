import { describe, it, expect, beforeEach, vi } from "vitest";
import "../mocks/supabase";
import { mockSupabase } from "../mocks/supabase";

const { triggerSocleSync, getLastSyncRun, listSocleCategories, listSocleOrganizations } =
  await import("@/services/socleSyncService");

const ORG_ID = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("socleSyncService", () => {
  describe("triggerSocleSync", () => {
    it("invoque l'edge function en mode synchrone avec l'org ciblée", async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { message: "Synchronisation terminée", dry_run: false, results: [] },
        error: null,
      });

      const result = await triggerSocleSync(ORG_ID);

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith("sync-socle-referentiel", {
        body: { organization_id: ORG_ID, background: false, dry_run: false },
      });
      expect(result.message).toBe("Synchronisation terminée");
    });

    it("transmet dry_run=true en mode simulation", async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { message: "Simulation terminée", dry_run: true, results: [] },
        error: null,
      });

      await triggerSocleSync(ORG_ID, { dryRun: true });

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith("sync-socle-referentiel", {
        body: { organization_id: ORG_ID, background: false, dry_run: true },
      });
    });

    it("propage l'erreur retournée par la fonction", async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { error: "Clé API Socle invalide ou révoquée (401) — synchronisation interrompue" },
        error: null,
      });

      await expect(triggerSocleSync(ORG_ID)).rejects.toThrow(/401/);
    });
  });

  describe("getLastSyncRun", () => {
    it("retourne le dernier run réel (hors dry-run) de l'org", async () => {
      const run = {
        id: "run-1",
        organization_id: ORG_ID,
        status: "success",
        dry_run: false,
        counters: null,
        error: null,
      };
      const maybeSingle = vi.fn().mockResolvedValue({ data: run, error: null });
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle,
      };
      mockSupabase.from.mockReturnValue(builder);

      const result = await getLastSyncRun(ORG_ID);

      expect(mockSupabase.from).toHaveBeenCalledWith("socle_sync_runs");
      expect(builder.eq).toHaveBeenCalledWith("organization_id", ORG_ID);
      expect(builder.eq).toHaveBeenCalledWith("dry_run", false);
      expect(result?.id).toBe("run-1");
    });

    it("retourne null quand aucun run n'existe", async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      expect(await getLastSyncRun(ORG_ID)).toBeNull();
    });
  });

  describe("listSocleCategories", () => {
    it("ne retourne que les catégories non obsolètes de l'org", async () => {
      const category = { id: "c-1", socle_id: "s-1", name: "État civil", obsoleted_at: null };
      const order = vi.fn().mockResolvedValue({ data: [category], error: null });
      const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        order,
      };
      mockSupabase.from.mockReturnValue(builder);

      const result = await listSocleCategories(ORG_ID);

      expect(mockSupabase.from).toHaveBeenCalledWith("socle_categories");
      expect(builder.is).toHaveBeenCalledWith("obsoleted_at", null);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("État civil");
    });
  });

  describe("listSocleOrganizations", () => {
    it("appelle l'action list-organizations et retourne les orgs", async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { organizations: [{ id: "so-1", name: "ACCM", slug: "laurentville", status: "active", parent_id: null, type: null }] },
        error: null,
      });

      const orgs = await listSocleOrganizations();

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        "sync-socle-referentiel?action=list-organizations",
        { body: {} },
      );
      expect(orgs).toHaveLength(1);
      expect(orgs[0].name).toBe("ACCM");
    });
  });
});
