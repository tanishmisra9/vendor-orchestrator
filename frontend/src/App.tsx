import { Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";

import { fetchSession, login, logout } from "./api";
import { AppShell, AuthGate } from "./components";
import { AddVendorPage, AuditTrailPage, BatchPipelinePage, OverviewPage, VendorMasterPage } from "./pages";
import type { SessionResponse } from "./types";

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  async function handleLogin(password: string) {
    await login({ password });
    const nextSession = await fetchSession();
    setSession(nextSession);
  }

  async function handleLogout() {
    await logout();
    const nextSession = await fetchSession();
    setSession(nextSession);
  }

  if (loading || !session) {
    return (
      <div className="loading-stage">
        <div className="loading-ring" />
        <p>Loading workspace...</p>
      </div>
    );
  }

  if (session.require_auth && !session.authenticated) {
    return <AuthGate onLogin={handleLogin} />;
  }

  return (
    <AppShell onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/batch" element={<BatchPipelinePage />} />
        <Route path="/add-vendor" element={<AddVendorPage />} />
        <Route path="/vendor-master" element={<VendorMasterPage />} />
        <Route path="/audit" element={<AuditTrailPage />} />
      </Routes>
    </AppShell>
  );
}
