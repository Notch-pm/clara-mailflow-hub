import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { mockSupabase } from "../mocks/supabase";

/**
 * La file « à signer » et, surtout, son ancienneté.
 *
 * L'ancienneté ne peut pas se lire sur `couriers.updated_at` — un trigger le
 * repousse à chaque sauvegarde du brouillon. Elle vient de l'historique, dont
 * l'écriture est best-effort : le repli doit donc être testé, pas supposé.
 */

let authState: { user: { id: string } | null };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/contexts/OrganizationContext", () => ({
  useOrganization: () => ({ organizationId: "org-1" }),
}));

const { useEluSignatureQueue } = await import("@/hooks/useEluSignatureQueue");

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

/**
 * Réponses par table. `couriers` est interrogée DEUX fois — les réponses, puis
 * les courriers parents — d'où l'aiguillage sur les colonnes demandées :
 * seule la seconde réclame `received_at`.
 */
function stubTables(tables: Record<string, unknown[]>, parents: unknown[] = []) {
  mockSupabase.from.mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {};
    let rows = tables[table] ?? [];
    builder.select = vi.fn((columns: string) => {
      if (table === "couriers" && columns.includes("received_at")) rows = parents;
      return builder;
    });
    for (const m of ["eq", "in", "order", "ilike", "limit", "filter", "not", "is"]) {
      builder[m] = vi.fn(() => builder);
    }
    builder.maybeSingle = vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null }));
    builder.single = vi.fn(() => Promise.resolve({ data: rows[0] ?? null, error: null }));
    builder.then = vi.fn((resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
    );
    return builder;
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const SIGNATORY = {
  id: "sig-1",
  first_name: "Laurent",
  last_name: "Saillard",
  signature_storage_key: "k.png",
};

beforeEach(() => {
  authState = { user: { id: "user-1" } };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useEluSignatureQueue", () => {
  it("sans fiche de signataire → file vide, mais l'onglet reste légitime", async () => {
    // Élu et signataire sont deux qualités indépendantes : on ne masque pas
    // l'onglet, on explique.
    stubTables({ signatories: [], workflow_states: [{ id: "st-sig" }] });

    const { result } = renderHook(() => useEluSignatureQueue(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSignatory).toBe(false);
    expect(result.current.count).toBe(0);
    expect(result.current.items).toEqual([]);
  });

  it("lit l'ancienneté dans l'historique, et retombe sur la création sinon", async () => {
    stubTables(
      {
        signatories: [SIGNATORY],
        workflow_states: [{ id: "st-sig" }],
        couriers: [
          {
            id: "r1",
            subject: "Re: bac endommagé",
            chrono: null,
            created_at: daysAgo(1),
            parent_courier_id: "p1",
            assigned_service: "Environnement",
            courier_participants: [
              { role: "recipient", name: "Thierry Henry", first_name: null, last_name: null },
            ],
          },
          {
            id: "r2",
            subject: "Re: calendrier de collecte",
            chrono: null,
            // Aucun événement pour celle-ci : c'est la date de création qui parle.
            created_at: daysAgo(2),
            parent_courier_id: "p2",
            assigned_service: "Environnement",
            courier_participants: [
              { role: "recipient", name: null, first_name: "Sophie", last_name: "Marchand" },
            ],
          },
        ],
        courier_events: [
          { courier_id: "p1", created_at: daysAgo(5), payload: { reply_id: "r1", to_state_id: "st-sig" } },
          // Plus ancien, et sur un état hors signature : ne doit pas être retenu.
          { courier_id: "p1", created_at: daysAgo(9), payload: { reply_id: "r1", to_state_id: "st-autre" } },
        ],
      },
      [
        {
          id: "p1",
          subject: "Bac endommagé par le camion",
          chrono: "2026-E-00025",
          received_at: daysAgo(9),
          courier_participants: [
            { role: "sender", name: "Thierry Henry", first_name: null, last_name: null, socle_contact_id: "c-1" },
          ],
        },
        { id: "p2", subject: "Calendrier de collecte 2027", chrono: "2026-E-00031", received_at: null, courier_participants: [] },
      ],
    );

    const { result } = renderHook(() => useEluSignatureQueue(), { wrapper });

    await waitFor(() => expect(result.current.count).toBe(2));

    // Triée du plus ancien au plus récent : ce qui attend le plus vient d'abord.
    const [first, second] = result.current.items;
    expect(first.replyId).toBe("r1");
    expect(first.waitingDays).toBe(5);
    expect(first.senderName).toBe("Thierry Henry");
    expect(second.replyId).toBe("r2");
    expect(second.waitingDays).toBe(2);
    expect(second.senderName).toBe("Sophie Marchand");
  });

  it("affiche l'objet du courrier parent, pas le « Re: » de la réponse", async () => {
    stubTables(
      {
        signatories: [SIGNATORY],
        workflow_states: [{ id: "st-sig" }],
        couriers: [
          {
            id: "r1",
            subject: "Re: objet recopié à la création",
            chrono: null,
            created_at: daysAgo(0),
            parent_courier_id: "p1",
            assigned_service: null,
            courier_participants: [
              { role: "sender", name: "Service", first_name: null, last_name: null },
            ],
          },
        ],
        courier_events: [],
      },
      // Le parent a pu être renommé depuis la création de la réponse : c'est
      // lui qui fait foi.
      [{ id: "p1", subject: "Objet corrigé depuis", chrono: "2026-E-00025", received_at: null, courier_participants: [] }],
    );

    const { result } = renderHook(() => useEluSignatureQueue(), { wrapper });

    await waitFor(() => expect(result.current.count).toBe(1));
    await waitFor(() => expect(result.current.items[0].title).toBe("Objet corrigé depuis"));
    expect(result.current.items[0].chrono).toBe("2026-E-00025");
    // Aucun participant « recipient » : pas de nom inventé.
    expect(result.current.items[0].senderName).toBeNull();
  });

  it("nomme l'usager d'après l'EXPÉDITEUR du courrier reçu", async () => {
    // Le destinataire de la réponse recopie l'expéditeur à la création, mais il
    // manque dès que la réponse a été créée à la main : c'est le courrier reçu
    // qui fait foi, et c'est lui qui porte l'identifiant de la fiche usager.
    stubTables(
      {
        signatories: [SIGNATORY],
        workflow_states: [{ id: "st-sig" }],
        couriers: [
          {
            id: "r1",
            subject: "Re: demande",
            chrono: null,
            created_at: daysAgo(0),
            parent_courier_id: "p1",
            assigned_service: null,
            courier_participants: [],
          },
        ],
        courier_events: [],
      },
      [
        {
          id: "p1",
          subject: "Demande",
          chrono: null,
          received_at: daysAgo(4),
          courier_participants: [
            { role: "sender", name: "Claire Dubois", first_name: null, last_name: null, socle_contact_id: "c-9" },
          ],
        },
      ],
    );

    const { result } = renderHook(() => useEluSignatureQueue(), { wrapper });

    await waitFor(() => expect(result.current.count).toBe(1));
    await waitFor(() => expect(result.current.items[0].senderName).toBe("Claire Dubois"));
    expect(result.current.items[0].senderContactId).toBe("c-9");
    // La date de réception du courrier reçu, pour la ligne « De X · reçu le … ».
    expect(result.current.items[0].receivedAt).not.toBeNull();
  });

  it("signale une fiche de signataire sans signature manuscrite", async () => {
    // L'élu est bien signataire, mais rien n'a été déposé : le détail devra
    // dire pourquoi le bouton est gris.
    stubTables({
      signatories: [{ ...SIGNATORY, signature_storage_key: null }],
      workflow_states: [{ id: "st-sig" }],
      couriers: [],
      courier_events: [],
    });

    const { result } = renderHook(() => useEluSignatureQueue(), { wrapper });

    await waitFor(() => expect(result.current.isSignatory).toBe(true));
    expect(result.current.hasSignature).toBe(false);
  });
});
