import { Link } from "wouter";
import { Video, Shield, Zap, Code, Terminal, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="px-6 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-background/80 backdrop-blur-md z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground">
            <Video size={16} />
          </div>
          <span className="font-bold text-xl tracking-tight">VeloRec</span>
        </div>
        <div className="flex gap-4">
          <Link href="/sign-in">
            <Button variant="ghost" className="font-medium">Sign In</Button>
          </Link>
          <Link href="/sign-up">
            <Button className="font-medium">Get Started</Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="py-24 px-6 max-w-5xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Zap size={14} />
            <span>The developer-first debugging tool</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-balance leading-tight">
            Stop guessing. <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-purple-400">
              Start reproducing.
            </span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Record your browser tab, network requests, console logs, and interactions in one click. 
            Share a pixel-perfect replay of exactly what went wrong.
          </p>
          <div className="flex items-center justify-center gap-4 pt-4">
            <Link href="/sign-up">
              <Button size="lg" className="h-12 px-8 text-base font-medium shadow-lg hover:shadow-primary/25 transition-all">
                Start Recording Free
              </Button>
            </Link>
            <Link href="/sign-in">
              <Button size="lg" variant="outline" className="h-12 px-8 text-base font-medium">
                View Demo
              </Button>
            </Link>
          </div>
        </section>

        {/* Features Grid */}
        <section className="py-24 px-6 bg-secondary/50 border-t border-border">
          <div className="max-w-5xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="p-6 rounded-2xl bg-card border border-border shadow-sm">
                <div className="w-12 h-12 rounded-lg bg-blue-500/10 text-blue-500 flex items-center justify-center mb-4">
                  <Video size={24} />
                </div>
                <h3 className="text-lg font-bold mb-2">High-Fidelity Replay</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Capture exactly what the user saw. No more "it works on my machine" back-and-forths.
                </p>
              </div>
              <div className="p-6 rounded-2xl bg-card border border-border shadow-sm">
                <div className="w-12 h-12 rounded-lg bg-green-500/10 text-green-500 flex items-center justify-center mb-4">
                  <Activity size={24} />
                </div>
                <h3 className="text-lg font-bold mb-2">Network Level Deep Dive</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Inspect every fetch, XHR, and asset request. View headers, payloads, and response times instantly.
                </p>
              </div>
              <div className="p-6 rounded-2xl bg-card border border-border shadow-sm">
                <div className="w-12 h-12 rounded-lg bg-orange-500/10 text-orange-500 flex items-center justify-center mb-4">
                  <Terminal size={24} />
                </div>
                <h3 className="text-lg font-bold mb-2">Console & Interactions</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Every console.log, warning, and error captured perfectly. Track user clicks and navigations chronologically.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border bg-card">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2 mb-4 md:mb-0">
            <Video size={16} />
            <span className="font-semibold text-foreground">VeloRec</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-6">
            <a href="/privacy" className="hover:text-foreground transition-colors">Privacy</a>
            <a href="#" className="hover:text-foreground transition-colors">Terms</a>
            <a href="#" className="hover:text-foreground transition-colors">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
