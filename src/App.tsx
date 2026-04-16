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
import CourriersEntrants from "@/pages/CourriersEntrants";
import CourriersSortants from "@/pages/CourriersSortants";
import CourierDetail from "@/pages/CourierDetail";
import WorkflowDetail from "@/pages/WorkflowDetail";
import SettingsPage from "@/pages/SettingsPage";
import Liens from "@/pages/Liens";
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

function ProtectedRoutes() {
  const { session, loading, profile, profileLoaded } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/connexion" replace />;

  // Wait for profile fetch to complete
  if (!profileLoaded) return <LoadingScreen />;

  // If profile is null after loading, user has no record — sign out to avoid loop
  if (!profile) {
    return <NoProfileFallback />;
  }

  // Redirect superadmins to their dashboard
  if (isSuperAdmin(profile)) {
    return <Navigate to="/superadmin" replace />;
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
                  <Route path="/courriers-entrants" element={<CourriersEntrants />} />
                  <Route path="/courriers-sortants" element={<CourriersSortants />} />
                  <Route path="/courrier/:id" element={<CourierDetail />} />
                  <Route path="/workflows/:id" element={<WorkflowDetail />} />
                  <Route path="/parametres" element={<SettingsPage />} />
                  <Route path="/liens" element={<Liens />} />
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
