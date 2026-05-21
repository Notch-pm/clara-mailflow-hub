import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Pencil } from "lucide-react";

type CourierChannel = "paper" | "email";

interface Props {
  value: CourierChannel | null;
  onChange: (v: CourierChannel) => void;
  done: boolean;
  onEdit?: () => void;
}

const CHANNELS: {
  value: CourierChannel;
  label: string;
  icon: string;
  available: boolean;
}[] = [
  { value: "paper", label: "Courrier papier", icon: "✉︎", available: true },
  { value: "email", label: "Courriel", icon: "@", available: true },
  { value: "portal" as unknown as CourierChannel, label: "Guichet", icon: "🏛", available: false },
  { value: "portal2" as unknown as CourierChannel, label: "Portail citoyen", icon: "🌐", available: false },
];

const CHANNEL_LABELS: Record<CourierChannel, string> = {
  paper: "Courrier papier",
  email: "Courriel",
};

export default function BulkStep1Channel({ value, onChange, done, onEdit }: Props) {
  if (done && value) {
    return (
      <div className="flex items-center gap-3 py-2 px-4 rounded-lg bg-muted/50">
        <span className="text-sm text-muted-foreground">Canal :</span>
        <span className="text-sm font-medium">{CHANNEL_LABELS[value]}</span>
        {onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 px-2 ml-auto">
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Modifier
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {CHANNELS.map((ch) => {
        const isAvailable = ch.available;
        const isSelected = value === ch.value;
        return (
          <button
            key={ch.value}
            type="button"
            disabled={!isAvailable}
            onClick={() => isAvailable && onChange(ch.value as CourierChannel)}
            className={cn(
              "relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center",
              isAvailable ? "cursor-pointer hover:border-primary/50" : "cursor-not-allowed opacity-40",
              isSelected ? "border-primary bg-primary/5" : "border-border bg-card"
            )}
          >
            <span className="text-2xl">{ch.icon}</span>
            <span className="text-sm font-medium leading-tight">{ch.label}</span>
            {!isAvailable && (
              <span className="absolute top-1.5 right-2 text-[10px] text-muted-foreground font-medium">À venir</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
