import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getCourierAccess, getCourierById, type CourierAccess } from "@/services/courierService";
import { ConfidentialAccessDenied, OutOfScopeAccessDenied } from "@/components/courier/ConfidentialAccessDenied";
import CourierWorkspacePage from "@/components/courier/CourierWorkspacePage";
import type { WorkspaceCourier } from "@/hooks/useCourierWorkspace";

export default function CourierDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { organizationId } = useOrganization();

  const { data, isLoading } = useQuery({
    // Clé propre à la page (forme { courier, access }) : `ContentIntentsTab`
    // tient `["courier", id, organizationId]` avec une autre forme. Le préfixe
    // `["courier", id]` reste, pour les invalidations des onglets.
    queryKey: ["courier", id, organizationId, "page"],
    queryFn: async (): Promise<{ courier: WorkspaceCourier | null; access: CourierAccess }> => {
      if (!organizationId || !id) return { courier: null, access: "missing" };
      const { data, error } = await getCourierById(organizationId, id);
      if (data) return { courier: data, access: "ok" };
      // Aucune ligne : absent, ou confidentiel — la base le dit sans rien révéler.
      if (error && error.code !== "PGRST116") throw error;
      return { courier: null, access: await getCourierAccess(id) };
    },
    enabled: !!organizationId && !!id,
  });
  const courier = data?.courier;

  if (!organizationId) {
    return <div className="p-8 text-center text-muted-foreground">Sélectionnez une organisation.</div>;
  }
  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Chargement…</div>;
  }
  if (data?.access === "confidential") {
    return <ConfidentialAccessDenied />;
  }
  if (data?.access === "out_of_scope") {
    return <OutOfScopeAccessDenied />;
  }
  if (!courier) {
    return <div className="p-8 text-center text-muted-foreground">Courrier introuvable.</div>;
  }

  return (
    <CourierWorkspacePage
      courier={courier}
      organizationId={organizationId}
      onClose={() => {
        // navigate(-1) fails (blank page) when there is no prior history entry,
        // e.g. after a transfer on a deep-linked courier. Fall back to the inbox.
        if (location.key === "default") {
          navigate("/a-instruire", { replace: true });
        } else {
          navigate(-1);
        }
      }}
    />
  );
}
