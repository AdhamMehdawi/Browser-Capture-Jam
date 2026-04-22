import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { Activity, Settings, LogOut, Video, Menu, X } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

// The sidebar is now a togglable off-canvas drawer (closed by default).
// Persisted in localStorage so the user's choice sticks across reloads.
const STORAGE_KEY = "velorec.sidebar.open";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
  });

  // Persist + reflect state.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? "1" : "0"); } catch { /* ignore */ }
  }, [open]);

  // Close on Escape for keyboard parity.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Activity },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Floating menu button — always visible, top-left */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className={`fixed top-4 left-4 z-40 bg-card border border-border shadow-sm ${open ? "opacity-0 pointer-events-none" : "opacity-100"} transition-opacity`}
        aria-label="Open navigation"
      >
        <Menu size={18} />
      </Button>

      {/* Backdrop — click to close. Shown when drawer is open. */}
      <div
        className={`fixed inset-0 bg-black/50 z-40 transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />

      {/* Off-canvas sidebar */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-sidebar border-r border-border flex flex-col z-50 shadow-2xl transition-transform duration-200 ease-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        role="navigation"
        aria-label="Sidebar"
      >
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
              <Video size={16} />
            </div>
            <span className="font-bold text-lg tracking-tight">VeloRec</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </Button>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <div
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors ${
                  location === item.href || location.startsWith(item.href + "/")
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                <item.icon size={18} />
                <span className="font-medium text-sm">{item.label}</span>
              </div>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarImage src={user?.imageUrl} />
              <AvatarFallback>{user?.firstName?.[0] || "U"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user?.fullName || user?.primaryEmailAddress?.emailAddress}
              </p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => signOut()} aria-label="Sign out">
              <LogOut size={16} className="text-muted-foreground" />
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content fills the whole viewport now that the sidebar is off-canvas */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-background">
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </div>
  );
}
