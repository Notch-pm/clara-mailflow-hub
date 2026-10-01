import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getMailroomCourier } from "@/services/mailroomService";
import { remindService, routeCourier, routeCouriers, transferCourier } from "@/services/courierRoutingService";
import type { SocleOrgWithConfig } from "@/services/socleOrgConfigService";

const INVALIDATED = ["mailroom-couriers", "mailbox-couriers", "instruction-couriers", "courier-events", "courier"];

/** Gestes du gestionnaire courrier : router (seul ou en lot), réaffecter, relancer. */
export function useMailroomActions(organizationId: string) {
  const queryClient = useQueryClient();
  const refresh = () => INVALIDATED.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

  const route = useMutation({
    mutationFn: async ({ courierId, org }: { courierId: string; org: SocleOrgWithConfig }) => {
      const courier = await getMailroomCourier(organizationId, courierId);
      await routeCourier(organizationId, courier, org);
      return org.name;
    },
    onSuccess: (name) => {
      refresh();
      toast.success("Courrier routé", { description: `Transmis à ${name}. Suivi dans « En cours ».` });
    },
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
    onSuccess: ({ routed, failed }) => {
      refresh();
      if (routed.length) {
        toast.success(`${routed.length} courrier${routed.length > 1 ? "s" : ""} routé${routed.length > 1 ? "s" : ""}`, {
          description: "Propositions à confiance ≥ 90 % validées.",
        });
      }
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
    onSuccess: (name) => {
      refresh();
      toast.success("Courrier réaffecté", { description: `Transféré à ${name}.` });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remind = useMutation({
    mutationFn: async (courierId: string) => {
      const courier = await getMailroomCourier(organizationId, courierId);
      await remindService(organizationId, courier);
      return courier.assigned_service;
    },
    onSuccess: (service) => {
      refresh();
      toast.success("Relance envoyée", { description: `${service ?? "Le service"} a été relancé.` });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return { route, routeBatch, reassign, remind };
}
