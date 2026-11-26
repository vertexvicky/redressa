import { useCallback, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { JudgeModal } from "./components/JudgeModal.js";
import { Layout, type MeProfile } from "./components/Layout.js";
import { apiFetch } from "./lib/api.js";
import { logoutFirebase, subscribeAuth } from "./lib/firebase.js";
import { ThemeProvider } from "./lib/theme.js";
import { AdminPage } from "./pages/admin/AdminPage.js";
import { CitizenPage } from "./pages/citizen/CitizenPage.js";
import { DashboardPage } from "./pages/dashboard/DashboardPage.js";
import { LandingPage } from "./pages/landing/LandingPage.js";
import { OfficerPage } from "./pages/officer/OfficerPage.js";
import { RecordsPage } from "./pages/records/RecordsPage.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1
    }
  }
});

function AppShell() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [judgeModalOpen, setJudgeModalOpen] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      const me = await apiFetch<MeProfile>("/api/v1/me");
      setProfile(me);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    const unsub = subscribeAuth((fbUser) => {
      if (fbUser) {
        void loadProfile().finally(() => setAuthReady(true));
      } else {
        setProfile(null);
        setAuthReady(true);
      }
    });
    return unsub;
  }, [loadProfile]);

  const handleLogout = async () => {
    setJudgeModalOpen(false);
    await logoutFirebase();
    setProfile(null);
    queryClient.clear();
    navigate("/");
  };

  return (
    <Layout
      user={profile}
      onLogout={handleLogout}
      onOpenJudge={() => setJudgeModalOpen(true)}
    >
      {!authReady ? (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">
          Loading Redressa...
        </div>
      ) : (
        <Routes>
          <Route
            path="/"
            element={
              <LandingPage
                user={profile}
                onAuthChanged={loadProfile}
                onOpenJudge={() => setJudgeModalOpen(true)}
              />
            }
          />
          <Route
            path="/citizen"
            element={
              profile ? (
                profile.role === "officer" ? (
                  <Navigate to="/officer" replace />
                ) : (
                  <CitizenPage user={profile} />
                )
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/officer"
            element={
              profile ? (
                profile.role === "citizen" ? (
                  <Navigate to="/citizen" replace />
                ) : (
                  <OfficerPage user={profile} />
                )
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route
            path="/records"
            element={profile ? <RecordsPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/admin"
            element={profile ? <AdminPage user={profile} /> : <Navigate to="/" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      <JudgeModal open={judgeModalOpen} onClose={() => setJudgeModalOpen(false)} />
    </Layout>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
