import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrganizationProvider } from "@/contexts/OrganizationContext";
import { AppLayout } from "@/components/AppLayout";
import Dashboard from "@/pages/Dashboard";
import CourriersEntrants from "@/pages/CourriersEntrants";
import CourriersSortants from "@/pages/CourriersSortants";
import CourierDetail from "@/pages/CourierDetail";
import Workflows from "@/pages/Workflows";
import Liens from "@/pages/Liens";
import UsersPage from "@/pages/UsersPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <OrganizationProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/courriers-entrants" element={<CourriersEntrants />} />
              <Route path="/courriers-sortants" element={<CourriersSortants />} />
              <Route path="/courrier/:id" element={<CourierDetail />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/utilisateurs" element={<UsersPage />} />
              <Route path="/liens" element={<Liens />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </OrganizationProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
