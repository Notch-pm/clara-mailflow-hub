import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle2, ShieldCheck } from "lucide-react";

export default function ActivateAccount() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [success, setSuccess] = useState(false);
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

    const hash = window.location.hash;
    if (
      hash.includes("type=recovery") ||
      hash.includes("type=invite") ||
      hash.includes("type=signup") ||
      hash.includes("access_token")
    ) {
      supabase.auth.signOut().then(() => {
        setReady(true);
      });
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password.length < 8) {
      toast({ title: "Erreur", description: "Le mot de passe doit contenir au moins 8 caractères.", variant: "destructive" });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: "Erreur", description: "Les mots de passe ne correspondent pas.", variant: "destructive" });
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
          toast({ title: "Erreur", description: "Lien d'activation invalide ou expiré. Contactez votre administrateur.", variant: "destructive" });
          setLoading(false);
          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({ password });
        await supabase.auth.signOut();

        if (updateError) {
          toast({ title: "Erreur", description: updateError.message, variant: "destructive" });
          setLoading(false);
          return;
        }

        setSuccess(true);
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        await supabase.auth.signOut();

        if (error) {
          toast({ title: "Erreur", description: error.message, variant: "destructive" });
          setLoading(false);
          return;
        }

        setSuccess(true);
      }
    } catch {
      toast({ title: "Erreur", description: "Une erreur est survenue.", variant: "destructive" });
    }

    setLoading(false);
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center space-y-4">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
            <h2 className="text-xl font-semibold">Compte activé !</h2>
            <p className="text-muted-foreground text-sm">
              Votre mot de passe a été défini avec succès. Vous pouvez maintenant vous connecter.
            </p>
            <Button onClick={() => navigate("/connexion")} className="mt-4">
              Se connecter
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-8 text-center text-muted-foreground space-y-3">
            <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground/50" />
            <p>Lien d'activation invalide ou expiré.</p>
            <p className="text-sm">Contactez votre administrateur pour recevoir un nouveau lien.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Activez votre compte</CardTitle>
          <CardDescription>Choisissez un mot de passe pour accéder à votre espace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Mot de passe</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Minimum 8 caractères"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmer le mot de passe</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Retapez votre mot de passe"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Activer mon compte
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
