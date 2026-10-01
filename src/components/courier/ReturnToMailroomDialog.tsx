import { useEffect, useState } from "react";
import { Loader2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: { done: string; todo: string }) => void;
  pending: boolean;
}

/**
 * « Je ne sais pas à qui le confier » : le service renvoie le courrier au
 * service courrier, qui le réoriente. Ce qui reste à faire est obligatoire —
 * c'est ce que lira le gestionnaire courrier pour choisir le bon service.
 */
export default function ReturnToMailroomDialog({ open, onOpenChange, onConfirm, pending }: Props) {
  const [done, setDone] = useState("");
  const [todo, setTodo] = useState("");
  useEffect(() => {
    if (open) {
      setDone("");
      setTodo("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Renvoyer au service courrier</DialogTitle>
          <DialogDescription>
            Le courrier quitte votre organisation et rejoint « À réorienter » : le service courrier le confiera au
            bon service.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="return-done">Déjà traité</Label>
            <Textarea
              id="return-done"
              value={done}
              onChange={(e) => setDone(e.target.value)}
              placeholder="Ce que votre service a déjà fait (facultatif)"
              rows={2}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="return-todo">Reste à faire</Label>
            <Textarea
              id="return-todo"
              value={todo}
              onChange={(e) => setTodo(e.target.value)}
              placeholder="Ce qui ne relève pas de votre service, et pourquoi"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button disabled={!todo.trim() || pending} onClick={() => onConfirm({ done, todo })} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            Renvoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
