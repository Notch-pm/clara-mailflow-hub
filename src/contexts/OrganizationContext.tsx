import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { setOrganizationId as setClientOrgId } from "@/integrations/supabase/client";

interface OrganizationContextType {
  organizationId: string | null;
  setOrganizationId: (id: string | null) => void;
}

const OrganizationContext = createContext<OrganizationContextType>({
  organizationId: null,
  setOrganizationId: () => {},
});

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [organizationId, setOrganizationIdState] = useState<string | null>(
    () => localStorage.getItem("clara_org_id")
  );

  const setOrganizationId = (id: string | null) => {
    setOrganizationIdState(id);
    setClientOrgId(id);
    if (id) {
      localStorage.setItem("clara_org_id", id);
    } else {
      localStorage.removeItem("clara_org_id");
    }
  };

  // Sync on mount
  useEffect(() => {
    setClientOrgId(organizationId);
  }, []);

  return (
    <OrganizationContext.Provider value={{ organizationId, setOrganizationId }}>
      {children}
    </OrganizationContext.Provider>
  );
}

export function useOrganization() {
  const context = useContext(OrganizationContext);
  if (!context) {
    throw new Error("useOrganization must be used within OrganizationProvider");
  }
  return context;
}
