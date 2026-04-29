import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";

export function NotificationBell() {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  useEffect(() => {
    const base = "Clara, Gestion de courrier";
    document.title = unreadCount > 0 ? `(${unreadCount}) ${base}` : base;
  }, [unreadCount]);

  function handleNotificationClick(id: string, resourceId: string | null) {
    markRead(id);
    if (resourceId) {
      navigate(`/boite-aux-lettres?open=${resourceId}`);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[10px] font-bold text-destructive-foreground leading-none">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent side="bottom" align="end" className="w-80 p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <span className="text-xs text-muted-foreground">
                ({unreadCount} non lue{unreadCount > 1 ? "s" : ""})
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2"
              onClick={() => markAllRead()}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Tout marquer comme lu
            </Button>
          )}
        </div>

        {/* List */}
        {notifications.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-20" />
            Aucune notification
          </div>
        ) : (
          <ScrollArea className="max-h-[360px]">
            {notifications.map((notif, i) => (
              <div key={notif.id}>
                <button
                  type="button"
                  onClick={() => handleNotificationClick(notif.id, notif.resource_id)}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-muted/60 transition-colors",
                    !notif.read && "bg-primary/5"
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        !notif.read ? "bg-primary" : "bg-transparent"
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm truncate",
                        !notif.read ? "font-semibold text-foreground" : "text-muted-foreground"
                      )}>
                        {notif.title ?? "Nouveau courrier"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDistanceToNow(new Date(notif.created_at), {
                          addSuffix: true,
                          locale: fr,
                        })}
                      </p>
                    </div>
                  </div>
                </button>
                {i < notifications.length - 1 && <Separator />}
              </div>
            ))}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  );
}
