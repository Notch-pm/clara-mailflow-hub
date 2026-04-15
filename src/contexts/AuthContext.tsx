import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { setOrganizationId } from "@/integrations/supabase/client";

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
  organization_name: string;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  membership: OrgMembership | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [membership, setMembership] = useState<OrgMembership | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);

  function clearUserData() {
    setProfile(null);
    setMembership(null);
  }

  async function fetchUserData(userId: string): Promise<UserProfile | null> {
    // Fetch user profile — cast needed because is_superadmin isn't in generated types yet
    const { data: profileData } = await supabase
      .from("users")
      .select("id, email, first_name, last_name, is_active, is_superadmin")
      .eq("id", userId)
      .maybeSingle() as { data: UserProfile | null };

    console.log("[AuthContext] profile fetched:", profileData?.email, "superadmin:", profileData?.is_superadmin);
    setProfile(profileData);

    // Fetch organization membership
    const { data: membershipData } = await supabase
      .from("organization_users")
      .select("organization_id, role, is_active, organizations(name)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    if (membershipData) {
      const orgName = (membershipData.organizations as any)?.name ?? "";
      const mem: OrgMembership = {
        organization_id: membershipData.organization_id,
        role: membershipData.role,
        is_active: membershipData.is_active,
        organization_name: orgName,
      };
      setMembership(mem);

      // Auto-set organization context
      setOrganizationId(membershipData.organization_id);
      localStorage.setItem("clara_org_id", membershipData.organization_id);
    } else {
      setMembership(null);
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
      const fetchedProfile = await fetchUserData(nextSession.user.id);

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
    }

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

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider
      value={{ session, user, profile, membership, loading, signOut }}
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
