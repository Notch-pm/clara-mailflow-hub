import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";
import { recordLogin } from "@/pages/BoiteAuxLettres";
import { forgetDevicePush } from "@/services/pushSubscriptionService";

interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean | null;
  is_superadmin: boolean;
}

interface OrgMembership {
  organization_id: string;
  role: string;
  is_active: boolean | null;
  /** Droit de signer une réponse — transverse, indépendant du rôle. */
  is_signataire: boolean | null;
  /** Qualité affichée sous la signature (« Vice-président »). */
  signataire_title: string | null;
  organization_name: string;
  organization_logo_url: string | null;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  profileLoaded: boolean;
  membership: OrgMembership | null;
  loading: boolean;
  /** Profil ou rattachement illisible malgré les nouvelles tentatives. */
  loadError: boolean;
  retryLoad: () => void;
  signOut: () => Promise<void>;
}

/** Délais avant chaque nouvelle tentative : 3 essais sur ~2 s au total. */
const RETRY_DELAYS_MS = [500, 1500];

/**
 * Rejoue une requête tant qu'elle échoue. Une erreur réseau ou un jeton pas
 * encore pris en compte juste après le login ne doit pas être lue comme
 * « pas de profil » (déconnexion) ou « aucune organisation ».
 */
export async function withRetry<T>(
  run: () => PromiseLike<{ data: T; error: unknown }>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await run();
    if (!error) return data;
    if (attempt >= RETRY_DELAYS_MS.length) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [membership, setMembership] = useState<OrgMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const userIdRef = useRef<string | null>(null);
  // Les pages lisent l'organisation dans OrganizationContext, initialisé depuis
  // localStorage au seul montage : l'écrire ici, et non dans localStorage seul,
  // sinon un login sans rechargement laisse les pages sur l'organisation
  // précédente (ou aucune) jusqu'au F5.
  const { setOrganizationId } = useOrganization();

  function clearUserData() {
    setProfile(null);
    setProfileLoaded(false);
    setMembership(null);
    setOrganizationId(null);
  }

  async function fetchUserData(userId: string): Promise<UserProfile | null> {
    // Fetch user profile — cast needed because is_superadmin isn't in generated types yet
    const profileData = await withRetry(() =>
      supabase
        .from("users")
        .select("id, email, first_name, last_name, is_active, is_superadmin")
        .eq("id", userId)
        .maybeSingle() as PromiseLike<{ data: UserProfile | null; error: unknown }>,
    );

    // Fetch organization membership
    const membershipData = await withRetry(() =>
      supabase
        .from("organization_users")
        .select("organization_id, role, is_active, is_signataire, signataire_title, organizations(name, logo_url)")
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle(),
    );

    // N'écrire l'état qu'une fois les deux lectures réussies : un échec laisse
    // le profil et le rattachement précédents intacts.
    setProfile(profileData);

    if (membershipData) {
      const org = membershipData.organizations as any;
      const mem: OrgMembership = {
        organization_id: membershipData.organization_id,
        role: membershipData.role,
        is_active: membershipData.is_active,
        is_signataire: membershipData.is_signataire ?? null,
        signataire_title: membershipData.signataire_title ?? null,
        organization_name: org?.name ?? "",
        organization_logo_url: org?.logo_url ?? null,
      };
      setMembership(mem);

      // Auto-set organization context (client x-org-id, état React, localStorage)
      setOrganizationId(membershipData.organization_id);
    } else {
      setMembership(null);
      setOrganizationId(null);
    }

    return profileData;
  }

  async function syncAuthState(nextSession: Session | null) {
    const nextUserId = nextSession?.user?.id ?? null;
    const isSameUser = nextUserId != null && nextUserId === userIdRef.current;
    if (!isSameUser) {
      setLoading(true);
    }

    setSession(nextSession);
    setUser(nextSession?.user ?? null);
    userIdRef.current = nextUserId;

    if (nextSession?.user) {
      recordLogin();
      let fetchedProfile: UserProfile | null;
      try {
        fetchedProfile = await fetchUserData(nextSession.user.id);
      } catch (error) {
        console.error("[auth] lecture du profil / rattachement impossible", error);
        // Rafraîchissement de jeton du même utilisateur : on garde ce qui est
        // déjà chargé. Nouvelle connexion : écran d'erreur avec « Réessayer ».
        if (!isSameUser) setLoadError(true);
        setProfileLoaded(true);
        setLoading(false);
        return;
      }
      setLoadError(false);

      // Block deactivated users
      if (fetchedProfile && fetchedProfile.is_active === false) {
        clearUserData();
        setSession(null);
        setUser(null);
        userIdRef.current = null;
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }
    } else {
      clearUserData();
      setLoadError(false);
    }

    setProfileLoaded(true);
    setLoading(false);
  }

  useEffect(() => {
    let isMounted = true;

    const runSync = (nextSession: Session | null) => {
      setTimeout(() => {
        if (!isMounted) return;
        void syncAuthState(nextSession);
      }, 0);
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      runSync(nextSession);
    });

    void supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (!isMounted) return;
      void syncAuthState(initialSession);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  function retryLoad() {
    setLoadError(false);
    userIdRef.current = null; // repasser par l'écran de chargement
    void supabase.auth.getSession().then(({ data }) => syncAuthState(data.session));
  }

  async function signOut() {
    // Poste partagé d'accueil : l'appareil ne doit pas continuer à recevoir les
    // notifications de l'agent qui s'en va. Best effort — jamais bloquant.
    await forgetDevicePush();
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ session, user, profile, profileLoaded, membership, loading, loadError, retryLoad, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
