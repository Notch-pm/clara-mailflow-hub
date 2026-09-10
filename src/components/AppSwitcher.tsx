import { Check, LayoutGrid } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { CURRENT_APP_KEY, EDILUMEN_APPS } from "@/lib/apps";

/**
 * Sélecteur d'application de la suite Edilumen, ancré dans le coin gauche de
 * l'en-tête. Basculer change de sous-domaine ; l'organisation courante est
 * conservée puisqu'elle est portée par le Socle, pas par l'application.
 */
export function AppSwitcher() {
  const { membership } = useAuth();
  const organizationName = membership?.organization_name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Changer d'application"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LayoutGrid className="h-5 w-5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-[420px] max-w-[calc(100vw-2rem)] p-3"
      >
        <p className="px-1 pb-2.5 text-xs font-bold text-muted-foreground">
          Changer d'application
        </p>

        <div className="grid grid-cols-2 gap-2">
          {EDILUMEN_APPS.map((app) => {
            if (app.key === CURRENT_APP_KEY) {
              return (
                <div
                  key={app.key}
                  aria-current="true"
                  className="flex flex-col gap-1.5 rounded-xl border border-primary bg-primary/5 p-3"
                >
                  <span className="flex w-full items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary text-[13px] font-extrabold text-primary-foreground"
                    >
                      {app.initial}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] font-bold">{app.name}</span>
                    <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="sr-only">Application courante</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{app.tagline}</span>
                </div>
              );
            }

            return (
              // Les classes vivent sur l'item (où `cn` fusionne avec les styles par
              // défaut) : `asChild` concatène sans arbitrer, l'enfant perdrait.
              <DropdownMenuItem
                key={app.key}
                asChild
                className="flex cursor-pointer flex-col items-start gap-1.5 rounded-xl border bg-card p-3 transition-[background-color,box-shadow] hover:bg-muted hover:shadow-md focus:bg-muted focus:text-foreground"
              >
                <a href={app.url}>
                  <span className="flex w-full items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-[13px] font-extrabold text-foreground"
                    >
                      {app.initial}
                    </span>
                    <span className="min-w-0 flex-1 text-[15px] font-bold">{app.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{app.tagline}</span>
                </a>
              </DropdownMenuItem>
            );
          })}
        </div>

        {organizationName && (
          <p className="mt-2.5 border-t pt-2.5 text-xs text-muted-foreground">
            Vous restez sur l'organisation {organizationName}.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
