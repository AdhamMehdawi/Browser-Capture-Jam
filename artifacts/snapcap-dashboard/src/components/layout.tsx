import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { Activity, Settings, LogOut, Menu, ChevronDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [expanded, setExpanded] = useState(false);

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: Activity },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden">
        {/* Top bar — full width, always on top */}
        <header className="shrink-0 h-14 border-b border-border bg-card flex items-center justify-between px-4 z-40">
          <div className="flex items-center gap-12">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-color cursor-pointer"
              aria-label="Toggle sidebar"
            >
              <Menu size={20} />
            </button>
            <Link href="/dashboard">
              <div className="flex items-center gap-2.5 cursor-pointer">
                <img src="/logo-icon.svg" alt="VeloCap" className="w-7 h-7 object-contain" />
                <span className="font-bold text-base tracking-tight">VeloCap</span>
              </div>
            </Link>
          </div>

          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors outline-none">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={user.imageUrl} />
                    <AvatarFallback className="text-xs">{user.firstName?.[0] || "U"}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium hidden sm:inline">{user.fullName || user.primaryEmailAddress?.emailAddress}</span>
                  <ChevronDown size={14} className="text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <div className="px-2 py-1.5">
                  <p className="text-sm font-medium">{user.fullName}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.primaryEmailAddress?.emailAddress}</p>
                </div>
                <DropdownMenuSeparator />
                <Link href="/settings">
                  <DropdownMenuItem className="cursor-pointer gap-2">
                    <Settings size={14} />
                    Settings
                  </DropdownMenuItem>
                </Link>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()} className="cursor-pointer gap-2 text-destructive focus:text-destructive">
                  <LogOut size={14} />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>

        {/* Below the top bar: sidebar + content side by side */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar — icon strip under the top bar */}
          <aside
            className={`shrink-0 h-full bg-card border-r border-border flex flex-col items-center transition-all duration-200 ease-out ${
              expanded ? "w-52" : "w-16"
            }`}
          >
            <nav className="flex-1 w-full py-3 space-y-1 px-2">
              {navItems.map((item) => {
                const active = location === item.href || location.startsWith(item.href + "/");
                const button = (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={`flex items-center gap-3 rounded-lg cursor-pointer transition-colors ${
                        expanded ? "px-3 py-2.5" : "justify-center py-2.5"
                      } ${
                        active
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-accent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <item.icon size={20} className="shrink-0" />
                      {expanded && <span className="text-sm font-medium whitespace-nowrap">{item.label}</span>}
                    </div>
                  </Link>
                );

                if (expanded) return <div key={item.href}>{button}</div>;

                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {item.label}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </nav>

            {/* Bottom avatar */}
            <div className={`w-full border-t border-border p-2 ${expanded ? "px-3" : ""}`}>
              {expanded ? (
                <div className="flex items-center gap-3 px-2 py-2">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarImage src={user?.imageUrl} />
                    <AvatarFallback className="text-xs">{user?.firstName?.[0] || "U"}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{user?.fullName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</p>
                  </div>
                </div>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex justify-center py-2 cursor-default">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user?.imageUrl} />
                        <AvatarFallback className="text-xs">{user?.firstName?.[0] || "U"}</AvatarFallback>
                      </Avatar>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    {user?.fullName || "Account"}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </aside>

          {/* Page content */}
          <div className="flex-1 overflow-auto min-w-0">
            {children}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
