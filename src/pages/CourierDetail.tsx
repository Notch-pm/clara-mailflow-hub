import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "@/contexts/OrganizationContext";
import { getCourierById } from "@/services/courierService";
import MailboxSidePanel from "@/components/courier/MailboxSidePanel";

export default function CourierDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { organizationId } = useOrganization();

  const { data: courier, isLoading } = useQuery({
    queryKey: ["courier", id, organizationId],
    queryFn: async () => {
      if (!organizationId || !id) return null;
      const { data, error } = await getCourierById(organizationId, id);
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId && !!id,
  });

  if (!organizationId) {
    return <div className="p-8 text-center text-muted-foreground">Sélectionnez une organisation.</div>;
  }
  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">Chargement…</div>;
  }
  if (!courier) {
    return <div className="p-8 text-center text-muted-foreground">Courrier introuvable.</div>;
  }

  return (
    <MailboxSidePanel
      courier={courier as any}
      open={true}
      onOpenChange={(open) => {
        if (!open) navigate(-1);
      }}
      organizationId={organizationId}
      withTabs
      fullScreen
    />
  );
}
