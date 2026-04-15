import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrganizationProvider } from "@/contexts/OrganizationContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
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
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/connexion" replace />;

  return <Outlet />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (session) return <Navigate to="/" replace />;
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
