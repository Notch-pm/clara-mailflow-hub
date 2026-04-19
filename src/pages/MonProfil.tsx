import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Camera, Loader2, Trash2, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { UserAvatar } from "@/components/UserAvatar";
import { uploadUserAvatar, removeUserAvatar } from "@/services/avatarService";
import { supabase } from "@/integrations/supabase/client";

const profileSchema = z.object({
  first_name: z.string().min(1, "Prénom obligatoire").max(100),
  last_name: z.string().min(1, "Nom obligatoire").max(100),
});

type ProfileForm = z.infer<typeof profileSchema>;

export default function MonProfil() {
  const { user, profile, membership } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // Local avatar state synced with profile (profile from context doesn't include avatar_url)
  useEffect(() => {
    if (!user) return;
    void supabase
      .from("users")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => setAvatarUrl((data as any)?.avatar_url ?? null));
  }, [user]);

  const form = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    values: {
      first_name: profile?.first_name ?? "",
      last_name: profile?.last_name ?? "",
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (values: ProfileForm) => {
      if (!user) throw new Error("Non connecté");
      const { error } = await supabase
        .from("users")
        .update({ first_name: values.first_name, last_name: values.last_name })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profil mis à jour");
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Non connecté");
      return uploadUserAvatar(user.id, file);
    },
    onSuccess: (url) => {
      toast.success("Photo mise à jour");
      setAvatarUrl(url);
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeAvatarMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Non connecté");
      await removeUserAvatar(user.id);
    },
    onSuccess: () => {
      toast.success("Photo supprimée");
      setAvatarUrl(null);
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
  };

  if (!profile) {
    return (
      <div className="py-8 text-center text-muted-foreground">Chargement…</div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <UserIcon className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mon profil</h1>
          <p className="text-muted-foreground">Gérez vos informations personnelles</p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Avatar section */}
          <div className="flex items-center gap-4 pb-6 border-b">
            <UserAvatar
              firstName={profile.first_name}
              lastName={profile.last_name}
              email={profile.email}
              avatarUrl={avatarUrl}
              className="h-20 w-20 text-xl"
            />
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleAvatarFileChange}
              />
              <div className="flex flex-wrap gap-2">
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
                  {avatarUrl ? "Remplacer la photo" : "Ajouter une photo"}
                </Button>
                {avatarUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAvatarMutation.mutate()}
                    disabled={removeAvatarMutation.isPending}
                    className="text-destructive hover:text-destructive"
                  >
                    {removeAvatarMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                    ) : (
                      <Trash2 className="h-4 w-4 mr-1.5" />
                    )}
                    Supprimer
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">JPG, PNG ou WEBP — 5 Mo max</p>
            </div>
          </div>

          {/* Form section */}
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

              <div className="space-y-2">
                <FormLabel>Email</FormLabel>
                <Input value={profile.email} disabled />
                <p className="text-xs text-muted-foreground">L'adresse email ne peut pas être modifiée.</p>
              </div>

              {membership && (
                <div className="space-y-2">
                  <FormLabel>Rôle</FormLabel>
                  <div>
                    <Badge variant="secondary" className="capitalize">{membership.role}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Le rôle ne peut être modifié que par un administrateur.
                  </p>
                </div>
              )}

              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Enregistrement…" : "Enregistrer les modifications"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
