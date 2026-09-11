import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

/**
 * Fragment capturé à l'évaluation du module. Le lien de récupération de
 * Supabase revient sur `/reset-password#access_token=…&type=recovery`, mais
 * `detectSessionInUrl` consomme ce fragment et nettoie l'URL avant que l'effet
 * ci-dessous ne s'exécute — il ne reste alors qu'un `#` nu. Lire la valeur ici,
 * avant toute micro-tâche, supprime cette course.
 */
const INITIAL_HASH = typeof window !== "undefined" ? window.location.hash : "";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [tokenHash, setTokenHash] = useState("");
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const token = searchParams.get("token_hash");
    const type = searchParams.get("type");

    if (token && type) {
      setTokenHash(token);
      setReady(true);
      return;
    }

    const hashParams = new URLSearchParams(INITIAL_HASH.replace(/^#/, ""));
    const isRecovery = hashParams.get("type") === "recovery" || hashParams.has("access_token");
    if (hashParams.has("error") || !isRecovery) {
      return;
    }

    // Le lien ouvre une session de récupération : c'est elle qui autorise
    // updateUser(). Ne jamais la fermer avant que le mot de passe soit posé —
    // sinon la soumission échoue sur « Auth session is missing ».
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) {
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast({ title: "Erreur", description: "Le mot de passe doit contenir au moins 6 caractères.", variant: "destructive" });
      return;
    }
    setLoading(true);

    try {
      if (tokenHash) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: "recovery",
        });

        if (verifyError) {
          toast({ title: "Erreur", description: "Lien de réinitialisation invalide ou expiré.", variant: "destructive" });
          setLoading(false);
          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({ password });
        await supabase.auth.signOut();

        if (updateError) {
          toast({ title: "Erreur", description: updateError.message, variant: "destructive" });
        } else {
          toast({ title: "Succès", description: "Votre mot de passe a été mis à jour." });
          navigate("/connexion");
        }
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        await supabase.auth.signOut();

        if (error) {
          toast({ title: "Erreur", description: error.message, variant: "destructive" });
        } else {
          toast({ title: "Succès", description: "Votre mot de passe a été mis à jour." });
          navigate("/connexion");
        }
      }
    } catch {
      toast({ title: "Erreur", description: "Une erreur est survenue.", variant: "destructive" });
    }

    setLoading(false);
  }

  if (!ready) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center text-muted-foreground">
            Lien de réinitialisation invalide ou expiré.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Nouveau mot de passe</CardTitle>
          <CardDescription>Choisissez un nouveau mot de passe pour votre compte.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Nouveau mot de passe</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Mettre à jour le mot de passe
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
