import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  className?: string;
}

function getInitials(firstName?: string | null, lastName?: string | null, email?: string | null): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (f || l) {
    return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || "?";
  }
  if (email) return email.charAt(0).toUpperCase();
  return "?";
}

/**
 * Displays a user's avatar image when available, otherwise their initials
 * (first letter of first name + first letter of last name).
 */
export function UserAvatar({
  firstName,
  lastName,
  email,
  avatarUrl,
  className,
}: UserAvatarProps) {
  const initials = getInitials(firstName, lastName, email);
  return (
    <Avatar className={cn("h-8 w-8", className)}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={initials} /> : null}
      <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
