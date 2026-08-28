import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { BookOpen, ChevronDown, Library, LogOut, Menu, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { Brand } from "../components/brand";
import { useAuth } from "../features/auth/auth-state";
import { REALTIME_ACCESS_REVOKED_EVENT } from "../services/realtime/realtime-context";

function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [error, setError] = useState("");
  if (!user) return null;

  const initials = user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  async function handleLogout() {
    setIsLoggingOut(true);
    setError("");
    try {
      await logout();
      void navigate("/login", { replace: true });
    } catch {
      setError("Logout failed. Please try again.");
      setIsLoggingOut(false);
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="rw-user-trigger" aria-label="Open user menu">
        <span className="rw-avatar" aria-hidden="true">{initials}</span>
        {!compact ? (
          <>
            <span className="rw-user-trigger__identity">
              <strong>{user.displayName}</strong>
              <small>{user.email}</small>
            </span>
            <ChevronDown aria-hidden="true" size={16} />
          </>
        ) : null}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="rw-user-menu" sideOffset={8}>
          <div className="rw-user-menu__identity">
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
          </div>
          <DropdownMenu.Separator className="rw-menu-separator" />
          <DropdownMenu.Item asChild>
            <button disabled={isLoggingOut} onClick={() => void handleLogout()} type="button">
              <LogOut aria-hidden="true" size={17} />
              {isLoggingOut ? "Logging out…" : "Log out"}
            </button>
          </DropdownMenu.Item>
          {error ? <p className="rw-menu-error" role="alert">{error}</p> : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PrimaryNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary navigation" className="rw-primary-nav">
      <p>Collaborate</p>
      <NavLink
        className={({ isActive }) => (isActive ? "is-active" : "")}
        onClick={onNavigate}
        title="Research"
        to="/research"
      >
        <BookOpen aria-hidden="true" size={19} />
        <span>Research</span>
      </NavLink>
      <NavLink
        className={({ isActive }) => (isActive ? "is-active" : "")}
        onClick={onNavigate}
        title="Research Spaces"
        to="/spaces"
      >
        <Library aria-hidden="true" size={19} />
        <span>Research Spaces</span>
      </NavLink>
      <NavLink
        className={({ isActive }) => (isActive ? "is-active" : "")}
        onClick={onNavigate}
        title="Connections"
        to="/connections"
      >
        <UsersRound aria-hidden="true" size={19} />
        <span>Connections</span>
      </NavLink>
    </nav>
  );
}

function Sidebar() {
  return (
    <aside className="rw-sidebar">
      <div className="rw-sidebar__brand"><Brand /></div>
      <PrimaryNavigation />
      <div className="rw-sidebar__user"><UserMenu /></div>
    </aside>
  );
}

function MobileNavigation() {
  const [open, setOpen] = useState(false);

  return (
    <header className="rw-mobile-bar">
      <Dialog.Root onOpenChange={setOpen} open={open}>
        <Dialog.Trigger className="rw-icon-button" aria-label="Open navigation">
          <Menu aria-hidden="true" size={21} />
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="rw-dialog-overlay" />
          <Dialog.Content aria-describedby={undefined} className="rw-drawer">
            <div className="rw-drawer__header">
              <Dialog.Title><Brand /></Dialog.Title>
              <Dialog.Close className="rw-icon-button" aria-label="Close navigation">
                <X aria-hidden="true" size={21} />
              </Dialog.Close>
            </div>
            <PrimaryNavigation onNavigate={() => setOpen(false)} />
            <div className="rw-drawer__user"><UserMenu /></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Brand />
      <UserMenu compact />
    </header>
  );
}

export function AppShell() {
  const navigate = useNavigate();
  const [accessNotice, setAccessNotice] = useState("");

  useEffect(() => {
    const handleRevoked = () => {
      setAccessNotice("Your access to that Research Space changed. You have been returned to your spaces.");
      void navigate("/spaces", { replace: true });
    };
    window.addEventListener(REALTIME_ACCESS_REVOKED_EVENT, handleRevoked);
    return () => window.removeEventListener(REALTIME_ACCESS_REVOKED_EVENT, handleRevoked);
  }, [navigate]);

  return (
    <div className="rw-app-shell">
      <a className="rw-skip-link" href="#main-content">Skip to content</a>
      <Sidebar />
      <MobileNavigation />
      <main className="rw-main" id="main-content" tabIndex={-1}>
        {accessNotice ? (
          <div className="rw-access-notice" role="status">
            <span>{accessNotice}</span>
            <button onClick={() => setAccessNotice("")} type="button">Dismiss</button>
          </div>
        ) : null}
        <Outlet />
      </main>
    </div>
  );
}
