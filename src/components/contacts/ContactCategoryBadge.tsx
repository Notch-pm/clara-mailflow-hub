import { Building2, Landmark } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CONTACT_CATEGORY_LABELS,
  contactCategories,
  type ContactCategory,
} from "@/lib/contact-categories";
import type { SocleContactRole } from "@/services/socleContactService";

const CATEGORY_STYLE: Record<ContactCategory, string> = {
  // Tokens sémantiques seulement : primaire (vert Notch) pour l'interne,
  // secondaire (jaune Notch) pour les élus.
  interne: "border-primary/30 bg-primary/10 text-primary",
  elu: "border-secondary/50 bg-secondary/20 text-secondary-foreground",
};

const CATEGORY_ICON: Record<ContactCategory, typeof Building2> = {
  interne: Building2,
  elu: Landmark,
};

/** Pastille « Interne » ou « Élu ». */
export function ContactCategoryBadge({
  category,
  className,
}: {
  category: ContactCategory;
  className?: string;
}) {
  const Icon = CATEGORY_ICON[category];
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 px-1.5 py-0 text-[10px] font-medium", CATEGORY_STYLE[category], className)}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {CONTACT_CATEGORY_LABELS[category]}
    </Badge>
  );
}

/** Pastilles des catégories d'un contact — rien si le contact n'en porte aucune. */
export function ContactCategoryBadges({
  contact,
  className,
}: {
  contact: { roles?: SocleContactRole[] | null } | null | undefined;
  className?: string;
}) {
  const categories = contactCategories(contact);
  if (categories.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {categories.map((c) => (
        <ContactCategoryBadge key={c} category={c} />
      ))}
    </span>
  );
}
