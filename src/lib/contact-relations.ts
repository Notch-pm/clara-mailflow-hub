import {
  relationTargetTypes,
  type SocleContact,
  type SocleContactRelationInput,
  type SocleContactType,
} from "@/services/socleContactService";

type Relations = SocleContact["relations"];

export function relationsToInputs(relations: Relations | null | undefined): SocleContactRelationInput[] {
  return (relations ?? []).map((r) => ({ related_contact_id: r.contact.id, role_id: r.role.id }));
}

export function relationsWithout(relations: Relations | null | undefined, relationId: string): SocleContactRelationInput[] {
  return relationsToInputs((relations ?? []).filter((r) => r.id !== relationId));
}

/** La cible déjà choisie reste valable tant que le nouveau rôle l'accepte. */
export function targetStillValid(roleName: string, targetType: SocleContactType): boolean {
  return relationTargetTypes(roleName).includes(targetType);
}
