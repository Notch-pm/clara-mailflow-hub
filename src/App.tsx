import { useEffect, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OrganizationProvider } from "@/contexts/OrganizationContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { isSuperAdmin } from "@/lib/permissions";
import { AppLayout } from "@/components/AppLayout";
import { lazyRoute } from "@/lib/lazy-route";
import { SuperAdminLayout } from "@/components/SuperAdminLayout";
import { EluModeGate } from "@/components/elu/EluModeGate";
import { EluLayout } from "@/components/elu/EluLayout";
const EluAccueil = lazyRoute(() => import("@/pages/EluAccueil"));
const EluASigner = lazyRoute(() => import("@/pages/EluASigner"));
const EluAViser = lazyRoute(() => import("@/pages/EluAViser"));
const EluNouveauCourrier = lazyRoute(() => import("@/pages/EluNouveauCourrier"));
const EluReponse = lazyRoute(() => import("@/pages/EluReponse"));
const EluRecherche = lazyRoute(() => import("@/pages/EluRecherche"));
const EluUsager = lazyRoute(() => import("@/pages/EluUsager"));
const EluCourrier = lazyRoute(() => import("@/pages/EluCourrier"));
const EluDemande = lazyRoute(() => import("@/pages/EluDemande"));
const DemandeDetail = lazyRoute(() => import("@/pages/DemandeDetail"));
const EluIndicateurs = lazyRoute(() => import("@/pages/EluIndicateurs"));
import Dashboard from "@/pages/Dashboard";
import BoiteAuxLettres, { recordLogin } from "@/pages/BoiteAuxLettres";
const CourrierEntrant = lazyRoute(() => import("@/pages/CourrierEntrant"));
const Corbeille = lazyRoute(() => import("@/pages/Corbeille"));
const Parapheur = lazyRoute(() => import("@/pages/Parapheur"));
import CourriersEnInstruction from "@/pages/CourriersEnInstruction";
import CourriersTraites from "@/pages/CourriersTraites";
import CourriersArchives from "@/pages/CourriersArchives";
import CourriersSortants from "@/pages/CourriersSortants";
import CourierDetail from "@/pages/CourierDetail";
const WorkflowDetail = lazyRoute(() => import("@/pages/WorkflowDetail"));
const StatistiquesPage = lazyRoute(() => import("@/pages/StatistiquesPage"));
import SettingsPage from "@/pages/SettingsPage";
import MonProfil from "@/pages/MonProfil";
import Contacts from "@/pages/Contacts";
import RechercheCourrierPage from "@/pages/RechercheCourrierPage";
import Login from "@/pages/Login";
import ResetPassword from "@/pages/ResetPassword";
import ActivateAccount from "@/pages/ActivateAccount";
import SuperAdminDashboard from "@/pages/SuperAdminDashboard";
import OrganizationsAdmin from "@/pages/OrganizationsAdmin";
import OrgSettings from "@/pages/OrgSettings";
import BulkImport from "@/pages/BulkImport";
import NotFound from "@/pages/NotFound";
import PortalFormPage from "@/pages/PortalFormPage";
import TaskPublicPage from "@/pages/TaskPublicPage";
import Accessibility from "@/pages/Accessibility";
import { PushBootstrap } from "@/hooks/usePushSubscription";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

/**
 * Ancienne adresse de « À instruire » (ex-« Boîte aux lettres »). Les liens
 * déjà émis — notifications en base, push, mails, favoris — la portent encore,
 * souvent avec `?open=<id>` : on la garde, paramètres compris.
 */
function LegacyMailboxRedirect() {
  const { search } = useLocation();
  return <Navigate to={`/a-instruire${search}`} replace />;
}

function LoadingScreen() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
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
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background gap-4 px-6 text-center">
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

function LoadErrorFallback() {
  const { retryLoad, signOut } = useAuth();
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background gap-4 px-6 text-center">
      <h2 className="text-lg font-semibold text-foreground">Impossible de charger votre compte</h2>
      <p className="text-sm text-muted-foreground">
        Votre profil ou votre organisation n'a pas pu être lu. Vérifiez votre connexion puis réessayez.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={retryLoad}
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Réessayer
        </button>
        <button
          onClick={() => void signOut()}
          className="inline-flex items-center justify-center rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  );
}

function ProtectedRoutes() {
  const { session, loading, profile, profileLoaded, membership, loadError } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/connexion" replace />;

  // Wait for profile fetch to complete
  if (!profileLoaded) return <LoadingScreen />;

  // Lecture en échec après plusieurs essais : ni « pas de profil » (qui
  // déconnecterait) ni « aucune organisation »
  if (loadError) return <LoadErrorFallback />;

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

  return (
    <>
      {/* Un seul point de montage pour le push : touche `last_seen_at` de
          l'appareil et écoute le service worker (clic sur une carte quand
          Clara est déjà ouverte, renouvellement d'abonnement). */}
      <PushBootstrap />
      <Outlet />
    </>
  );
}

function SuperAdminRoute() {
  const { session, loading, profile, profileLoaded, loadError } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!session) return <Navigate to="/connexion" replace />;

  if (!profileLoaded) return <LoadingScreen />;
  if (loadError) return <LoadErrorFallback />;
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
              <Route path="/accessibilite" element={<Accessibility />} />
              <Route path="/portail/:token" element={<PortalFormPage />} />
              <Route path="/tache/:token" element={<TaskPublicPage />} />

              {/* Super Admin routes */}
              <Route path="/superadmin" element={<SuperAdminRoute />}>
                <Route index element={<SuperAdminDashboard />} />
                <Route path="organisations" element={<OrganizationsAdmin />} />
                <Route path="organisations/:orgId" element={<OrgSettings />} />
              </Route>

              {/* Regular user routes */}
              <Route element={<ProtectedRoutes />}>
                <Route element={<EluModeGate />}>
                  <Route element={<AppLayout />}>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/a-instruire" element={<BoiteAuxLettres />} />
                    <Route path="/boite-aux-lettres" element={<LegacyMailboxRedirect />} />
                    <Route path="/courrier-entrant" element={<Suspense fallback={<LoadingScreen />}><CourrierEntrant /></Suspense>} />
                    <Route path="/corbeille" element={<Suspense fallback={<LoadingScreen />}><Corbeille /></Suspense>} />
                    <Route path="/courriers-en-instruction" element={<CourriersEnInstruction />} />
                    <Route path="/parapheur" element={<Suspense fallback={<LoadingScreen />}><Parapheur /></Suspense>} />
                    <Route path="/courriers-traites" element={<CourriersTraites />} />
                    <Route path="/courriers-archives" element={<CourriersArchives />} />
                    <Route path="/courriers-sortants" element={<CourriersSortants />} />
                    <Route path="/courrier/:id" element={<CourierDetail />} />
                    <Route path="/workflows/:id" element={<Suspense fallback={<LoadingScreen />}><WorkflowDetail /></Suspense>} />
                    <Route path="/parametres" element={<SettingsPage />} />
                    <Route path="/mon-profil" element={<MonProfil />} />
                    <Route path="/contacts" element={<Contacts />} />
                    <Route path="/contacts/:id" element={<Contacts />} />
                    <Route path="/demandes/:irisRequestId" element={<Suspense fallback={<LoadingScreen />}><DemandeDetail /></Suspense>} />
                    <Route path="/recherche" element={<RechercheCourrierPage />} />
                    <Route path="/import-en-masse" element={<BulkImport />} />
                    <Route path="/statistiques" element={<Suspense fallback={<LoadingScreen />}><StatistiquesPage /></Suspense>} />
                  </Route>

                  {/* Espace élu : servi au rôle `elu` et aux viseurs sur téléphone. `EluModeGate`
                      y renvoie depuis `/`, et en ramène dès que l'une des trois
                      conditions tombe (rôle, largeur, affichage complet demandé). */}
                  <Route path="/elu" element={<EluLayout />}>
                    <Route index element={<Suspense fallback={<LoadingScreen />}><EluAccueil /></Suspense>} />
                    <Route path="a-signer" element={<Suspense fallback={<LoadingScreen />}><EluASigner /></Suspense>} />
                    <Route path="a-viser" element={<Suspense fallback={<LoadingScreen />}><EluAViser /></Suspense>} />
                    <Route path="nouveau-courrier" element={<Suspense fallback={<LoadingScreen />}><EluNouveauCourrier /></Suspense>} />
                    <Route path="reponse/:replyId" element={<Suspense fallback={<LoadingScreen />}><EluReponse /></Suspense>} />
                    <Route path="recherche" element={<Suspense fallback={<LoadingScreen />}><EluRecherche /></Suspense>} />
                    <Route path="usager/:contactId" element={<Suspense fallback={<LoadingScreen />}><EluUsager /></Suspense>} />
                    <Route path="courrier/:courierId" element={<Suspense fallback={<LoadingScreen />}><EluCourrier /></Suspense>} />
                    <Route path="demande/:irisRequestId" element={<Suspense fallback={<LoadingScreen />}><EluDemande /></Suspense>} />
                    {/* Les statistiques conviennent telles quelles à un élu :
                        la page est MONTÉE ici, jamais dupliquée. */}
                    <Route path="indicateurs" element={<Suspense fallback={<LoadingScreen />}><EluIndicateurs /></Suspense>} />
                  </Route>
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
