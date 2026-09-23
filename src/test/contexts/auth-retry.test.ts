import { describe, it, expect, vi, afterEach } from "vitest";
import { withRetry } from "@/contexts/AuthContext";

describe("withRetry (lecture du profil / rattachement au login)", () => {
  afterEach(() => vi.useRealTimers());

  it("rend la donnée dès qu'un essai réussit", async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error("réseau") })
      .mockResolvedValueOnce({ data: { id: "u1" }, error: null });

    const promise = withRetry(run);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ id: "u1" });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("ne confond pas « aucune ligne » et « erreur » : null sans erreur est rendu tel quel", async () => {
    const run = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(withRetry(run)).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("lève l'erreur après trois essais en échec", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue({ data: null, error: new Error("réseau") });

    const promise = withRetry(run);
    const assertion = expect(promise).rejects.toThrow("réseau");
    await vi.runAllTimersAsync();

    await assertion;
    expect(run).toHaveBeenCalledTimes(3);
  });
});
