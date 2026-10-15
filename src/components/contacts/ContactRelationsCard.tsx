import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ContactPicker from "@/components/courier/ContactPicker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useContactRoleCatalog } from "@/hooks/useContactRoles";
import { relationsToInputs, relationsWithout, targetStillValid } from "@/lib/contact-relations";
import {
  RELATION_STRUCTURE_TYPES,
  relationTargetTypes,
  SOCLE_CONTACT_TYPE_LABELS,
  updateContact,
  type SocleContact,
  type SocleContactRelationInput,
} from "@/services/socleContactService";

interface ContactRelationsCardProps {
  organizationId: string;
  contact: SocleContact;
  onUpdated: (saved: SocleContact) => void;
}

/**
 * Relations du contact dans le référentiel, dans les deux sens : « est
 * <rôle> de <contact> » (éditable ici) et « <contact> est <rôle> de ce
 * contact » (se gère depuis la fiche de l'autre contact).
 */
export default function ContactRelationsCard({ organizationId, contact, onUpdated }: ContactRelationsCardProps) {
  const navigate = useNavigate();
  const [newRoleId, setNewRoleId] = useState("");
  const [newTarget, setNewTarget] = useState<SocleContact | null>(null);

  const rolesQuery = useContactRoleCatalog(organizationId);

  const mutation = useMutation({
    mutationFn: (relations: SocleContactRelationInput[]) =>
      updateContact(organizationId, contact.id, { relations }),
    onSuccess: (saved) => {
      onUpdated(saved);
      setNewRoleId("");
      setNewTarget(null);
      toast.success("Relations mises à jour");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur"),
  });

  // La cible d'une relation dépend du rôle (Gérant → entreprise, Agent →
  // administration…) et n'est jamais une personne physique.
  const roles = rolesQuery.data ?? [];
  const selectedRole = roles.find((r) => r.id === newRoleId) ?? null;
  const targetTypes = selectedRole ? relationTargetTypes(selectedRole.name) : RELATION_STRUCTURE_TYPES;

  function handleRoleChange(roleId: string) {
    setNewRoleId(roleId);
    const role = roles.find((r) => r.id === roleId);
    if (role && newTarget && !targetStillValid(role.name, newTarget.contact_type)) {
      setNewTarget(null);
    }
  }

  function addRelation() {
    if (!newRoleId || !newTarget) return;
    if (newTarget.id === contact.id) {
      toast.error("Un contact ne peut pas avoir de relation avec lui-même");
      return;
    }
    mutation.mutate([
      ...relationsToInputs(contact.relations),
      { related_contact_id: newTarget.id, role_id: newRoleId },
    ]);
  }

  const outgoing = contact.relations ?? [];
  const incoming = contact.reverse_relations ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Relations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {outgoing.length === 0 && incoming.length === 0 && (
          <p className="text-sm text-muted-foreground">Aucune relation avec un autre contact.</p>
        )}

        {outgoing.length > 0 && (
          <div className="space-y-1.5">
            {outgoing.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-sm">
                <span>
                  Est <span className="font-medium">{r.role.name}</span> de{" "}
                  <button
                    type="button"
                    className="text-primary hover:underline inline-flex items-center gap-1"
                    onClick={() => navigate(`/contacts/${r.contact.id}`)}
                  >
                    {r.contact.display_name ?? "—"}
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive ml-auto"
                  aria-label="Retirer cette relation"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(relationsWithout(contact.relations, r.id))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {incoming.length > 0 && (
          <div className="space-y-1.5">
            {incoming.map((r) => (
              <div key={r.id} className="text-sm">
                <button
                  type="button"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                  onClick={() => navigate(`/contacts/${r.contact.id}`)}
                >
                  {r.contact.display_name ?? "—"}
                  <ExternalLink className="h-3 w-3" />
                </button>{" "}
                est <span className="font-medium">{r.role.name}</span> de ce contact
                <span className="text-xs text-muted-foreground"> (se modifie depuis sa fiche)</span>
              </div>
            ))}
          </div>
        )}

        <Separator />

        <div className="flex items-end gap-2 flex-wrap">
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Est…</div>
            <Select value={newRoleId || undefined} onValueChange={handleRoleChange}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Rôle" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[220px]">
            <div className="text-xs text-muted-foreground">
              de… {selectedRole
                ? `(${targetTypes.map((t) => SOCLE_CONTACT_TYPE_LABELS[t].toLowerCase()).join(", ")})`
                : "(choisissez d'abord un rôle)"}
            </div>
            <ContactPicker
              organizationId={organizationId}
              value={newTarget}
              onChange={setNewTarget}
              types={targetTypes}
              disabled={!selectedRole}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!newRoleId || !newTarget || mutation.isPending}
            onClick={addRelation}
          >
            <Plus className="h-4 w-4 mr-1" /> Ajouter
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
