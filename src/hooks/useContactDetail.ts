import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  archiveContact,
  getContact,
  isContactNotFound,
  restoreContact,
  type SocleContact,
} from "@/services/socleContactService";
import { listContactCouriers } from "@/services/courierParticipantService";

/** Courriers liés à la fiche : partagé avec la carte, lancé dès la fiche pour charger en parallèle. */
export function contactCouriersQuery(organizationId: string, contactId: string) {
  return {
    queryKey: ["socle-contact-couriers", organizationId, contactId],
    queryFn: () => listContactCouriers(organizationId, contactId),
  };
}

/** Fiche d'un contact du référentiel : lecture, archivage / restauration, mise à jour du cache. */
export function useContactDetail(organizationId: string | null | undefined, contactId: string) {
  const qc = useQueryClient();
  const key = ["socle-contact", organizationId, contactId];

  const contactQuery = useQuery({
    queryKey: key,
    queryFn: () => getContact(organizationId!, contactId),
    enabled: !!organizationId,
    retry: (count, error) => !isContactNotFound(error) && count < 2,
  });

  useQuery({ ...contactCouriersQuery(organizationId!, contactId), enabled: !!organizationId });

  /** Une fiche modifiée ailleurs que dans la requête : on remplace le cache et on rafraîchit les listes. */
  function applySaved(saved: SocleContact) {
    qc.setQueryData(key, saved);
    qc.invalidateQueries({ queryKey: ["socle-contacts"] });
  }

  const archiveMutation = useMutation({
    mutationFn: async (archive: boolean) =>
      archive ? archiveContact(organizationId!, contactId) : restoreContact(organizationId!, contactId),
    onSuccess: (contact) => {
      qc.setQueryData(key, contact);
      qc.invalidateQueries({ queryKey: ["socle-contacts"] });
      toast.success(contact.status === "archived" ? "Contact archivé dans le référentiel" : "Contact restauré");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  });

  return {
    contactQuery,
    contact: contactQuery.data ?? null,
    notFound: contactQuery.isError && isContactNotFound(contactQuery.error),
    archiveMutation,
    applySaved,
  };
}
