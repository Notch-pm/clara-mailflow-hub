import { createContext, useContext, useState, ReactNode } from "react";

interface OrganizationContextType {
  organizationId: string | null;
  setOrganizationId: (id: string | null) => void;
}

const OrganizationContext = createContext<OrganizationContextType>({
  organizationId: null,
  setOrganizationId: () => {},
});

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const [organizationId, setOrganizationId] = useState<string | null>(null);

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
