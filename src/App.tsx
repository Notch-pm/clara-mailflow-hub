import { useEffect, lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrganizationProvider } from "@/contexts/OrganizationContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { isSuperAdmin } from "@/lib/permissions";
import { AppLayout } from "@/components/AppLayout";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import Dashboard from "@/pages/Dashboard";
import BoiteAuxLettres, { recordLogin } from "@/pages/BoiteAuxLettres";
import CourriersEnInstruction from "@/pages/CourriersEnInstruction";
import CourriersTraites from "@/pages/CourriersTraites";
import CourriersArchives from "@/pages/CourriersArchives";
import CourriersSortants from "@/pages/CourriersSortants";
import CourierDetail from "@/pages/CourierDetail";
const WorkflowDetail = lazy(() => import("@/pages/WorkflowDetail"));
import SettingsPage from "@/pages/SettingsPage";
import MonProfil from "@/pages/MonProfil";
import Liens from "@/pages/Liens";
import Usagers from "@/pages/Usagers";
import RechercheCourrierPage from "@/pages/RechercheCourrierPage";
import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import ActivateAccount from "@/pages/ActivateAccount";
import SuperAdminDashboard from "@/pages/SuperAdminDashboard";
import OrganizationsAdmin from "@/pages/OrganizationsAdmin";
import OrgSettings from "@/pages/OrgSettings";
import NotFound from "@/pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

function NoProfileFallback() {
  const { signOut } = useAuth();
  useEffect(() => { void signOut(); }, []);
  return <LoadingScreen />;
}

function NoOrganizationFallback() {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-6 text-center">
      <div className="rounded-lg border p-6 max-w-md space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Aucune organisation associée</h2>
        <p className="text-sm text-muted-foreground">
          Votre compte n'est rattaché à aucune organisation. Contactez votre administrateur pour être ajouté à une organisation.
        </p>
        <button
          onClick={() => void signOut()}
          className="mt-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

function ProtectedRoutes() {
  const { session, loading, profile, profileLoaded, membership } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/connexion" replace />;

  // Wait for profile fetch to complete
  if (!profileLoaded) return <LoadingScreen />;

  // If profile is null after loading, user has no record — sign out to avoid loop
  if (!profile) {
    return <NoProfileFallback />;
  }

  // Redirect superadmins to their dashboard (no org required)
  if (isSuperAdmin(profile)) {
    return <Navigate to="/superadmin" replace />;
  }

  // Non-superadmin must have an organization
  if (!membership) {
    return <NoOrganizationFallback />;
  }

  return <Outlet />;
}

function SuperAdminRoute() {
  const { session, loading, profile, profileLoaded } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/connexion" replace />;

  if (!profileLoaded) return <LoadingScreen />;
  if (!profile || !isSuperAdmin(profile)) return <Navigate to="/" replace />;

  return <SuperAdminLayout />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, profile } = useAuth();
  if (loading) return <LoadingScreen />;
  if (session) {
    if (isSuperAdmin(profile)) return <Navigate to="/superadmin" replace />;
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <OrganizationProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/connexion" element={<PublicRoute><Login /></PublicRoute>} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/activer-compte" element={<ActivateAccount />} />

              {/* Super Admin routes */}
              <Route path="/superadmin" element={<SuperAdminRoute />}>
                <Route index element={<SuperAdminDashboard />} />
                <Route path="organisations" element={<OrganizationsAdmin />} />
                <Route path="organisations/:orgId" element={<OrgSettings />} />
              </Route>

              {/* Regular user routes */}
              <Route element={<ProtectedRoutes />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/boite-aux-lettres" element={<BoiteAuxLettres />} />
                  <Route path="/courriers-en-instruction" element={<CourriersEnInstruction />} />
                  <Route path="/courriers-traites" element={<CourriersTraites />} />
                  <Route path="/courriers-archives" element={<CourriersArchives />} />
                  <Route path="/courriers-sortants" element={<CourriersSortants />} />
                  <Route path="/courrier/:id" element={<CourierDetail />} />
                  <Route path="/workflows/:id" element={<Suspense fallback={<LoadingScreen />}><WorkflowDetail /></Suspense>} />
                  <Route path="/parametres" element={<SettingsPage />} />
                  <Route path="/mon-profil" element={<MonProfil />} />
                  <Route path="/liens" element={<Liens />} />
                  <Route path="/usagers" element={<Usagers />} />
                  <Route path="/usagers/:id" element={<Usagers />} />
                  <Route path="/recherche" element={<RechercheCourrierPage />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </OrganizationProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
