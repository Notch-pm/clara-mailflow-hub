import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * Suivi de l'analyse enfilée d'un courrier.
 *
 * La file travaille sans personne au bout du fil : c'est la fin du job, vue par
 * ce hook, qui fait relire la fiche et les listes. Sans elle, un courrier saisi à
 * la main restait « Non analysé » dans « Courrier entrant » (2026-E-00068).
 */

const getLatestAnalysisJob = vi.fn();
vi.mock("@/services/courierAnalysisJobService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/courierAnalysisJobService")>()),
  getLatestAnalysisJob: (...args: unknown[]) => getLatestAnalysisJob(...args),
}));

const { useCourierAnalysisJob, courierAnalysisJobQueryKey } = await import("@/hooks/useCourierAnalysisJob");

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, invalidate, wrapper };
}

const job = (status: string) => ({ id: "j1", status, last_error: null, created_at: "2026-10-13T09:12:00Z", finished_at: null });

describe("useCourierAnalysisJob", () => {
  it("lit le dernier job du courrier, scopé par organisation", async () => {
    getLatestAnalysisJob.mockResolvedValue(job("running"));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCourierAnalysisJob("org-1", "c1"), { wrapper });
    await waitFor(() => expect(result.current.inProgress).toBe(true));
    expect(getLatestAnalysisJob).toHaveBeenCalledWith("org-1", "c1");
  });

  it("fin du job : relit l'analyse, le courrier et « Courrier entrant »", async () => {
    getLatestAnalysisJob.mockResolvedValue(job("pending"));
    const { qc, invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCourierAnalysisJob("org-1", "c1"), { wrapper });
    await waitFor(() => expect(result.current.inProgress).toBe(true));
    expect(invalidate).not.toHaveBeenCalled();

    getLatestAnalysisJob.mockResolvedValue(job("done"));
    await qc.refetchQueries({ queryKey: courierAnalysisJobQueryKey("c1") });
    await waitFor(() => expect(result.current.inProgress).toBe(false));

    const keys = invalidate.mock.calls.map(([f]) => f?.queryKey).filter(Boolean);
    expect(keys).toContainEqual(["courier-analysis", "c1"]);
    expect(keys).toContainEqual(["courier-extracts", "c1"]);
    expect(keys).toContainEqual(["mailroom-couriers"]);
    const courierFilter = invalidate.mock.calls.map(([f]) => f).find((f) => f?.predicate);
    expect(courierFilter?.predicate?.({ queryKey: ["courier", "org-1", "c1"] } as never)).toBe(true);
    expect(courierFilter?.predicate?.({ queryKey: ["courier", "org-1", "autre"] } as never)).toBe(false);
  });

  it("courrier jamais passé par la file, ou job déjà terminé : rien à relire", async () => {
    getLatestAnalysisJob.mockResolvedValue(null);
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCourierAnalysisJob("org-1", "c1"), { wrapper });
    await waitFor(() => expect(getLatestAnalysisJob).toHaveBeenCalled());
    expect(result.current.inProgress).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
