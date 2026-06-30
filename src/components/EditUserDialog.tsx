import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { updateOrgMember } from "@/services/userService";
import { uploadUserAvatar, removeUserAvatar } from "@/services/avatarService";
import { UserAvatar } from "@/components/UserAvatar";
import type { OrgMember, OrgUserRole } from "@/types/user";
import { ORG_ROLES, ORG_ROLE_VALUES } from "@/lib/permissions";

const ROLES = ORG_ROLES;

const editSchema = z
  .object({
    first_name: z.string().min(1, "Prénom obligatoire").max(100),
    last_name: z.string().min(1, "Nom obligatoire").max(100),
    role: z.enum(ORG_ROLE_VALUES, { required_error: "Rôle obligatoire" }),
    is_signataire: z.boolean().default(false),
    signataire_title: z.string().max(150, "150 caractères maximum").optional().or(z.literal("")),
  })
  .refine((d) => !d.is_signataire || (d.signataire_title && d.signataire_title.trim().length > 0), {
    message: "Titre obligatoire pour un signataire",
    path: ["signataire_title"],
  });

interface Props {
  member: OrgMember | null;
  organizationId: string;
  onClose: () => void;
}

export function EditUserDialog({ member, organizationId, onClose }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    values: member
      ? {
          first_name: member.first_name ?? "",
          last_name: member.last_name ?? "",
          role: member.role as "administrateur" | "gestionnaire" | "consultant",
          is_signataire: member.is_signataire ?? false,
          signataire_title: member.signataire_title ?? "",
        }
      : { first_name: "", last_name: "", role: "consultant" as const, is_signataire: false, signataire_title: "" },
  });

  const isSignataire = form.watch("is_signataire");

  const updateMutation = useMutation({
    mutationFn: async (values: z.infer<typeof editSchema>) => {
      if (!member) throw new Error("Aucun utilisateur sélectionné");
      await updateOrgMember(organizationId, member.id, member.membership_id, {
        first_name: values.first_name,
        last_name: values.last_name,
        role: values.role,
        is_signataire: values.is_signataire,
        signataire_title: values.is_signataire ? (values.signataire_title?.trim() || null) : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      toast.success("Utilisateur mis à jour");
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!member) throw new Error("Aucun utilisateur sélectionné");
      return uploadUserAvatar(member.id, file);
    },
    onSuccess: () => {
      toast.success("Photo mise à jour");
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: async () => {
      if (!member) throw new Error("Aucun utilisateur sélectionné");
      await removeUserAvatar(member.id);
    },
    onSuccess: () => {
      toast.success("Photo supprimée");
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("La photo ne doit pas dépasser 5 Mo");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Format d'image non supporté");
      return;
    }
    uploadAvatarMutation.mutate(file);
    e.target.value = "";
  }

  return (
    <Dialog open={!!member} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier l'utilisateur</DialogTitle>
        </DialogHeader>
        {member && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 pb-3 border-b">
              <UserAvatar
                firstName={member.first_name}
                lastName={member.last_name}
                email={member.email}
                avatarUrl={member.avatar_url}
                className="h-16 w-16 text-lg"
              />
              <div className="flex flex-col gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadAvatarMutation.isPending}
                >
                  {uploadAvatarMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <Camera className="h-4 w-4 mr-1.5" />
                  )}
                  {member.avatar_url ? "Remplacer la photo" : "Ajouter une photo"}
                </Button>
                {member.avatar_url && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive justify-start px-2"
                    onClick={() => removeAvatarMutation.mutate()}
                    disabled={removeAvatarMutation.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Supprimer
                  </Button>
                )}
              </div>
            </div>

            <p className="text-sm text-muted-foreground">{member.email}</p>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => updateMutation.mutate(v))} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <FormField control={form.control} name="first_name" render={({ field }) => (
                    <FormItem><FormLabel>Prénom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="last_name" render={({ field }) => (
                    <FormItem><FormLabel>Nom</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem><FormLabel>Rôle</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {ROLES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select><FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="is_signataire" render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">Signataire</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Autorise cet utilisateur à signer les courriers.
                      </p>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
                {isSignataire && (
                  <FormField control={form.control} name="signataire_title" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Titre du signataire</FormLabel>
                      <FormControl>
                        <Input placeholder="ex. Maire, Directeur général…" maxLength={150} {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                )}
                <Button type="submit" className="w-full" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
                </Button>
              </form>
            </Form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
