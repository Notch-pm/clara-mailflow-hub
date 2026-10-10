import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getMailroomCourier } from "@/services/mailroomService";
import { enqueueCourierAnalyses } from "@/services/courierAnalysisJobService";
import { deleteCourier } from "@/services/courierService";
import { TRASH_RETENTION_DAYS } from "@/lib/trash";
import { remindService, routeCourier, routeCouriers, transferCourier } from "@/services/courierRoutingService";
import type { SocleOrgWithConfig } from "@/services/socleOrgConfigService";

const INVALIDATED = ["mailroom-couriers", "mailbox-couriers", "instruction-couriers", "courier-events", "courier"];

/**
 * Gestes du gestionnaire courrier : router (seul ou en lot), réaffecter, relancer.
 *
 * Router, réaffecter et relancer ne disent pas eux-mêmes leur succès : c'est
 * l'écran qui le fait (`useMailroomMoves`), une fois la liste relue, pour nommer
 * l'onglet où le courrier s'est rangé. Les erreurs, elles, se disent ici.
 */
export function useMailroomActions(organizationId: string) {
  const queryClient = useQueryClient();
  const refresh = () => INVALIDATED.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const route = useMutation({
    mutationFn: async ({ courierId, org }: { courierId: string; org: SocleOrgWithConfig }) => {
      const courier = await getMailroomCourier(organizationId, courierId);
      await routeCourier(organizationId, courier, org);
      return org.name;
    },
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  const routeBatch = useMutation({
    mutationFn: async (items: { courierId: string; org: SocleOrgWithConfig }[]) => {
      const couriers = await Promise.all(items.map((i) => getMailroomCourier(organizationId, i.courierId)));
      return routeCouriers(
        organizationId,
        couriers.map((courier, idx) => ({ courier, org: items[idx].org })),
      );
    },
    onSuccess: ({ failed }) => {
      refresh();
      if (failed.length) {
        toast.error(`${failed.length} courrier${failed.length > 1 ? "s" : ""} non routé${failed.length > 1 ? "s" : ""}`, {
          description: failed[0].error,
        });
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reassign = useMutation({
    mutationFn: async ({ courierId, org }: { courierId: string; org: SocleOrgWithConfig }) => {
      const courier = await getMailroomCourier(organizationId, courierId);
      await transferCourier(organizationId, courier, org);
      return org.name;
    },
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  const remind = useMutation({
    mutationFn: async (courierId: string) => {
      const courier = await getMailroomCourier(organizationId, courierId);
      await remindService(organizationId, courier);
      return courier.assigned_service;
    },
    onSuccess: refresh,
    onError: (err: Error) => toast.error(err.message),
  });

  // Analyse IA en file (`process-analysis-queue`) : le courrier passe en
  // « analyse en cours », puis rejoint « À valider » ou « À qualifier ».
  const analyze = useMutation({
    mutationFn: (courierIds: string[]) => enqueueCourierAnalyses(courierIds),
    onSuccess: (queued, courierIds) => {
      refresh();
      if (queued === 0) {
        toast.error("Analyse non lancée", { description: "Aucun courrier n'a pu être envoyé à l'analyse." });
        return;
      }
      toast.success(queued > 1 ? `${queued} courriers envoyés à l'analyse IA` : "Courrier envoyé à l'analyse IA", {
        description:
          queued < courierIds.length
            ? `${courierIds.length - queued} n'ont pas pu l'être.`
            : `${queued > 1 ? "Ils rejoindront" : "Il rejoindra"} « À valider » ou « À qualifier » une fois analysé${queued > 1 ? "s" : ""}.`,
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Même geste que la boîte aux lettres : le courrier part dans la corbeille
  // (avec ses réponses), restaurable 30 jours depuis « Corbeille et spam ».
  const remove = useMutation({
    mutationFn: async (courierId: string) => {
      const { error } = await deleteCourier(organizationId, courierId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["trash-couriers"] });
      toast.success("Courrier placé dans la corbeille", {
        description: `Il pourra être restauré pendant ${TRASH_RETENTION_DAYS} jours.`,
      });
    },
    onError: (err: Error) => toast.error("Suppression impossible", { description: err.message }),
  });

  return { route, routeBatch, reassign, remind, analyze, remove };
}
