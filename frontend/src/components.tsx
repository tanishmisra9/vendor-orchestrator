import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, LogOut, Sparkles } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { type FormEvent, type PropsWithChildren, useState } from "react";

type NavItem = {
  to: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Overview" },
  { to: "/batch", label: "Batch Pipeline" },
  { to: "/add-vendor", label: "Add Vendor" },
  { to: "/vendor-master", label: "Vendor Master" },
  { to: "/audit", label: "Audit Trail" },
];

export function AppShell({
  children,
  onLogout,
}: PropsWithChildren<{ onLogout: () => Promise<void> }>) {
  const location = useLocation();

  return (
    <div className="app-shell">
      <div className="top-glass-band" />
      <div className="ambient-glow ambient-glow-left" />
      <div className="ambient-glow ambient-glow-right" />
      <header className="nav-frame glass-surface">
        <div className="brand-lockup">
          <div className="brand-orb">
            <Sparkles size={18} />
          </div>
          <div>
            <p className="eyebrow">VendorOrchestrator</p>
            <h1>Vendor Master Console</h1>
          </div>
        </div>
        <nav className="nav-pills" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) => `nav-pill${isActive ? " active" : ""}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button className="ghost-button" type="button" onClick={() => void onLogout()}>
          <LogOut size={16} />
          Sign out
        </button>
      </header>
      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          className="page-frame"
          initial={{ opacity: 0, filter: "blur(16px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(8px)" }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.main>
      </AnimatePresence>
    </div>
  );
}

export function AuthGate({
  onLogin,
}: {
  onLogin: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await onLogin(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-stage">
      <div className="auth-hero">
        <p className="eyebrow">Secure Analyst Workspace</p>
        <h1>Beautiful control for messy vendor data.</h1>
        <p className="hero-copy">
          Clean master data, review duplicates, and move through bulk processing with a
          quieter, sharper interface.
        </p>
      </div>
      <motion.form
        className="auth-card glass-surface"
        onSubmit={handleSubmit}
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
      >
        <p className="eyebrow">Authentication</p>
        <h2>Enter the shared analyst password</h2>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
          />
        </label>
        {error ? <p className="error-text">{error}</p> : null}
        <button className="primary-button" type="submit" disabled={submitting}>
          {submitting ? "Signing in..." : "Unlock workspace"}
          <ArrowRight size={16} />
        </button>
      </motion.form>
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-header">
      <p className="eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="page-description">{description}</p>
    </div>
  );
}

export function GlassPanel({
  title,
  children,
  aside,
}: PropsWithChildren<{ title?: string; aside?: string }>) {
  return (
    <section className="glass-panel glass-surface">
      {title ? (
        <div className="panel-head">
          <h3>{title}</h3>
          {aside ? <p>{aside}</p> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric-card glass-surface">
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state glass-surface">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
