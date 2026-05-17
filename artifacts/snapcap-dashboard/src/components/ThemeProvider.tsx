// ============================================================
// ThemeProvider + ThemeToggle — design Layer A follow-up
//
// Manages `.dark` on <html> based on user choice (light / dark / system)
// persisted in localStorage. Respects `prefers-color-scheme` on first
// visit when no preference has been saved.
//
// Two pieces:
//   - <ThemeProvider> wraps the app and applies the class.
//   - useTheme() exposes the current theme + setter to any component.
//   - <ThemeToggle> is a 3-state segmented control rendered in the layout.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Monitor, Moon, Sun } from "lucide-react";

export type ThemePref = "light" | "dark" | "system";

interface ThemeCtx {
  /** What the user picked. "system" follows prefers-color-scheme. */
  pref: ThemePref;
  /** The mode currently applied (resolved from pref + system). */
  resolved: "light" | "dark";
  setPref: (next: ThemePref) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const STORAGE_KEY = "velocap.theme";

function readStored(): ThemePref {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => readStored());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // Listen for system-preference changes so users in "system" mode track them
  // without reloading.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved: "light" | "dark" = useMemo(() => {
    if (pref === "dark") return "dark";
    if (pref === "light") return "light";
    return systemDark ? "dark" : "light";
  }, [pref, systemDark]);

  // Apply / remove the .dark class on <html>.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    html.classList.toggle("dark", resolved === "dark");
    // Tell the browser which color-scheme to assume for native UI (scrollbars,
    // form controls, etc.).
    html.style.colorScheme = resolved;
  }, [resolved]);

  const setPref = useCallback((next: ThemePref) => {
    setPrefState(next);
    try {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be blocked (private mode in some browsers); ignore.
    }
  }, []);

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

// Segmented 3-state control: Light / System / Dark.
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { pref, setPref } = useTheme();
  const options: Array<{ value: ThemePref; label: string; Icon: typeof Sun }> = [
    { value: "light", label: "Light", Icon: Sun },
    { value: "system", label: "System", Icon: Monitor },
    { value: "dark", label: "Dark", Icon: Moon },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex rounded-md border border-border bg-card p-0.5 ${className}`}
    >
      {options.map(({ value, label, Icon }) => {
        const active = pref === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setPref(value)}
            title={label}
            className={
              "inline-flex items-center justify-center w-7 h-7 rounded transition-colors " +
              (active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-accent")
            }
          >
            <Icon size={14} />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Tiny script that runs in <head> BEFORE React mounts so the user doesn't
// see a flash of the wrong theme. Exported so we can also embed it via a
// <script> tag in index.html if we want eager application — for now we
// rely on React mounting fast enough that the flash is imperceptible.
export const themeInitScript = `
  (function(){
    try {
      var v = localStorage.getItem('${STORAGE_KEY}');
      var sys = window.matchMedia('(prefers-color-scheme: dark)').matches;
      var dark = v === 'dark' || (v !== 'light' && sys);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    } catch (e) { /* ignore */ }
  })();
`;
