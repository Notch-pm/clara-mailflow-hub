import { Building2, HeartHandshake, Landmark, User } from "lucide-react";
import type { SocleContactType } from "@/services/socleContactService";

export const CONTACT_TYPE_ICONS: Record<SocleContactType, typeof User> = {
  personne: User,
  entreprise: Building2,
  association: HeartHandshake,
  administration: Landmark,
};
