import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Loader2, Settings2, MapPin, Home } from "lucide-react";
import { toast } from "sonner";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import type { BanAddressSuggestion } from "@/services/banAddressService";

interface OrgRow {
  id: string;
  multiple_imap: boolean;
  domiciliary_file_enabled: boolean;
  address_street: string | null;
  address_complement: string | null;
  address_postal_code: string | null;
  address_city: string | null;
  phone: string | null;
  website: string | null;
  contact_email: string | null;
  courier_retention_days: number | null;
  usager_retention_days: number | null;
}

export default function GeneralSettings({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

  const { data: org, isLoading } = useQuery({
    queryKey: ["org-general", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations" as never)
        .select("id, multiple_imap, domiciliary_file_enabled, address_street, address_complement, address_postal_code, address_city, phone, website, contact_email")
        .eq("id", orgId)
        .single();
      if (error) throw error;
      return data as unknown as OrgRow;
    },
    enabled: !!orgId,
  });

  const toggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase
        .from("organizations" as never)
        .update({ multiple_imap: value } as never)
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-general", orgId] });
      toast.success("Configuration enregistrée");
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  const domiciliaryToggleMutation = useMutation({
    mutationFn: async (value: boolean) => {
      const { error } = await supabase
        .from("organizations" as never)
        .update({ domiciliary_file_enabled: value } as never)
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-general", orgId] });
      queryClient.invalidateQueries({ queryKey: ["org-domiciliary-file-enabled", orgId] });
      toast.success("Configuration enregistrée");
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  // Contact fields
  const [street, setStreet] = useState("");
  const [complement, setComplement] = useState("");
  const [postal, setPostal] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [contactEmail, setContactEmail] = useState("");

  useEffect(() => {
    if (!org) return;
    setStreet(org.address_street ?? "");
    setComplement(org.address_complement ?? "");
    setPostal(org.address_postal_code ?? "");
    setCity(org.address_city ?? "");
    setPhone(org.phone ?? "");
    setWebsite(org.website ?? "");
    setContactEmail(org.contact_email ?? "");
  }, [org]);

  const contactMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("organizations" as never)
        .update({
          address_street: street.trim() || null,
          address_complement: complement.trim() || null,
          address_postal_code: postal.trim() || null,
          address_city: city.trim() || null,
          phone: phone.trim() || null,
          website: website.trim() || null,
          contact_email: contactEmail.trim() || null,
        } as never)
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-general", orgId] });
      toast.success("Coordonnées enregistrées");
    },
    onError: (e: Error) => toast.error("Erreur : " + e.message),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Settings2 className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Configuration générale</CardTitle>
              <CardDescription>Paramètres globaux de l'organisation.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <Label className="text-sm font-medium">
                Différencier les adresses mail destinataires par service
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Permet de configurer une boîte IMAP différente par service pour la réception des emails.
              </p>
            </div>
            <Switch
              checked={org?.multiple_imap ?? false}
              disabled={toggleMutation.isPending}
              onCheckedChange={(val) => toggleMutation.mutate(val)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4 mt-4">
            <div className="flex items-start gap-3">
              <Home className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <Label className="text-sm font-medium">
                  Mode fichier domiciliaire
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Permet de saisir des informations supplémentaires sur les usagers (nom usuel, dates de naissance/décès, situation familiale, dates d'arrivée/départ, nationalité, adresse détaillée, second téléphone).
                </p>
              </div>
            </div>
            <Switch
              checked={org?.domiciliary_file_enabled ?? false}
              disabled={domiciliaryToggleMutation.isPending}
              onCheckedChange={(val) => domiciliaryToggleMutation.mutate(val)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <MapPin className="h-5 w-5 text-primary" />
            <div>
              <CardTitle className="text-base">Coordonnées de l'organisation</CardTitle>
              <CardDescription>Adresse postale et moyens de contact.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              contactMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="org-street">Numéro et voie</Label>
              <AddressAutocomplete
                id="org-street"
                value={street}
                onChange={setStreet}
                onSelect={(s: BanAddressSuggestion) => {
                  setStreet([s.number, s.btq, s.street].filter(Boolean).join(" "));
                  if (s.postcode) setPostal(s.postcode);
                  if (s.city) setCity(s.city);
                }}
                placeholder="Rechercher une adresse…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-complement">Complément d'adresse</Label>
              <Input id="org-complement" value={complement} onChange={(e) => setComplement(e.target.value)} maxLength={200} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="org-postal">Code postal</Label>
                <Input id="org-postal" value={postal} onChange={(e) => setPostal(e.target.value)} maxLength={20} />
              </div>
              <div className="space-y-2 col-span-2">
                <Label htmlFor="org-city">Ville</Label>
                <Input id="org-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="org-phone">Téléphone</Label>
                <Input id="org-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="org-contact-email">Courriel</Label>
                <Input id="org-contact-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={255} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-website">Site internet</Label>
              <Input id="org-website" type="url" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={255} placeholder="https://…" />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={contactMutation.isPending}>
                {contactMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enregistrer les coordonnées
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
