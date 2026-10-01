import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { UNASSIGNED_ORGANIZATION, type MailboxOrganizationOption } from "@/hooks/useMailboxOrganization";

interface MailboxOrganizationSelectProps {
  options: MailboxOrganizationOption[] | null;
  value: string | null;
  onChange: (id: string) => void;
}

function OptionLabel({ option }: { option: MailboxOrganizationOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="truncate">{option.name}</span>
      {option.count > 0 && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs font-bold tabular-nums text-muted-foreground">
          {option.count.toLocaleString("fr-FR")}
        </span>
      )}
    </span>
  );
}

/**
 * Bannette de la boîte aux lettres, à droite du titre : on y traite le courrier
 * d'une organisation à la fois, ou celui qui n'a pas encore de service désigné.
 */
export default function MailboxOrganizationSelect({ options, value, onChange }: MailboxOrganizationSelectProps) {
  if (!options || !value) return <Skeleton className="h-8 w-48" />;

  const organizations = options.filter((o) => o.id !== UNASSIGNED_ORGANIZATION);
  const unassigned = options.find((o) => o.id === UNASSIGNED_ORGANIZATION);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Organisation"
        className="h-8 w-full min-w-0 gap-1.5 md:w-auto md:max-w-[20rem] text-sm font-semibold [&>span]:min-w-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {organizations.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            <OptionLabel option={o} />
          </SelectItem>
        ))}
        {unassigned && (
          <>
            {organizations.length > 0 && <SelectSeparator />}
            <SelectItem value={unassigned.id}>
              <OptionLabel option={unassigned} />
            </SelectItem>
          </>
        )}
      </SelectContent>
    </Select>
  );
}
