export default function Privacy() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-foreground">
      <h1 className="text-3xl font-bold mb-1">VeloCap — Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8"><em>Last updated: 2026-05-10</em></p>

      <p className="mb-6 text-muted-foreground">
        VeloCap is a developer tool distributed as a Chrome extension and an accompanying web dashboard.
        This policy explains what data the extension collects, how it is used, and the choices you have.
      </p>

      <Section title="What the extension captures">
        <p>The extension only captures data when <strong>you explicitly click "Record"</strong>. While recording, on the tab you select, it captures:</p>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li>A screen recording of that tab</li>
          <li>Console log output from that tab</li>
          <li>Outbound network requests and their responses</li>
          <li>User interactions (clicks, input events, navigations) — <em>input values for passwords, emails, and credit cards are masked</em></li>
          <li>Page URL/title, referrer, and basic browser/device metadata</li>
        </ul>
        <p className="mt-3">The extension does <strong>not</strong> run background data collection. It does not read browsing history, cookies, passwords, or data from tabs other than the one you actively record.</p>
      </Section>

      <Section title="Automatic data redaction">
        <p>Before any captured data leaves your browser, VeloCap automatically redacts sensitive information:</p>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li><strong>HTTP headers</strong>: Authorization, Cookie, Set-Cookie, API keys, CSRF tokens — values replaced with [REDACTED]</li>
          <li><strong>Request/response bodies</strong>: passwords, tokens, secrets, API keys, credit card numbers, SSNs — values redacted while preserving field names for debugging</li>
          <li><strong>Console logs</strong>: JWTs, Bearer tokens, and known API key patterns are scrubbed</li>
        </ul>
        <p className="mt-3">This redaction happens entirely in your browser before upload. Sensitive data never reaches our servers.</p>
      </Section>

      <Section title="Authentication">
        <p>VeloCap uses <strong>Clerk</strong> for authentication. When you sign in, Clerk issues a session token that the extension and dashboard use to authenticate API requests. We do not store your password — Clerk handles credential management.</p>
      </Section>

      <Section title="Where data is stored">
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Video/screenshots</strong>: Azure Blob Storage (encrypted at rest with Microsoft-managed keys, HTTPS in transit)</li>
          <li><strong>DevTools data</strong> (console, network, actions): PostgreSQL database, encrypted at rest with <strong>AES-256-GCM</strong> application-level encryption</li>
          <li><strong>Account data</strong>: managed by Clerk (SOC 2 Type II certified)</li>
        </ul>
      </Section>

      <Section title="Who can access your recordings">
        <ul className="list-disc pl-6 space-y-1">
          <li>Only you can see your recordings on the dashboard</li>
          <li>If you generate a <strong>share link</strong>, anyone with that link can view the recording — but request/response bodies are stripped from shared recordings for privacy</li>
          <li>You can revoke a share link at any time</li>
        </ul>
      </Section>

      <Section title="Third parties">
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Clerk</strong> — authentication provider</li>
          <li><strong>Microsoft Azure</strong> — cloud infrastructure (Blob Storage, Container Apps, PostgreSQL)</li>
        </ul>
        <p className="mt-2">We do not sell your data or share it with advertisers.</p>
      </Section>

      <Section title="Data retention">
        <p>Your recordings and account data are retained until you delete them. There is no automatic deletion — you control when data is removed.</p>
      </Section>

      <Section title="Your rights">
        <p>You have the right to:</p>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li><strong>Access</strong> — view all your recordings and data on the dashboard</li>
          <li><strong>Export</strong> — download all your data as JSON from Settings → "Export My Data"</li>
          <li><strong>Delete</strong> — permanently delete your account and all recordings from Settings → "Delete My Account"</li>
          <li><strong>Withdraw consent</strong> — uninstall the extension at any time; no further data is captured</li>
        </ul>
      </Section>

      <Section title="Contact">
        <p>For privacy questions or data requests, contact us at <a href="mailto:tareq.tbakhi@gmail.com" className="text-primary hover:underline">tareq.tbakhi@gmail.com</a>.</p>
      </Section>

      <footer className="mt-12 pt-6 border-t border-border text-sm text-muted-foreground">
        This privacy policy applies to the VeloCap Chrome extension and the VeloCap web dashboard.
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-3 pb-2 border-b border-border">{title}</h2>
      <div className="text-muted-foreground space-y-2">{children}</div>
    </section>
  );
}
