# VeloCap — Chrome Web Store submission reference

Everything you need to fill in the Chrome Web Store Developer Dashboard form,
grouped by the tab you're on. Copy-paste each block as-is.

**Environment:** dev (extension points at `velocap-api-dev` + `salmon-sea-*` SWA)
**Package:** `/Users/mac/OpenJam/Browser-Capture-Jam/velocap-extension-dev.zip`
**Visibility target:** Unlisted

---

## Tab 1 — Store listing

### Product details

| Field | Value |
|---|---|
| Title *(auto from package)* | `VeloCap` |
| Summary *(auto from package)* | One-click bug capture — record screen, console, network, and user actions, then share a repro link. |
| Category | **Developer Tools** |
| Language | **English** |

### Description (paste into the Description box)

```
VeloCap is a developer tool that packages everything an engineer needs to reproduce a bug in one click: a screen recording, the full browser console, every network request and response, user interactions, and device metadata.

Click Record → do the thing that broke → click Stop. VeloCap uploads the session to your VeloCap dashboard and gives you a permalink you can paste into Slack, Jira, or a PR.

Features
• Screen recording via chrome.tabCapture (WebM)
• Console log capture (log / info / warn / error / unhandled rejections)
• Network capture — requests, responses, headers, bodies
• User action trail — clicks, inputs (values masked), navigations
• Browser + device metadata (UA, viewport, timezone)
• Share recordings with your team via permalinks from the VeloCap dashboard

Sign in with your VeloCap account (Clerk-based authentication) to start capturing.

This is an unlisted build distributed to the VeloCap team.
```

### Graphic assets

| Asset | Size | Required? | Source |
|---|---|---|---|
| Store icon | 128 × 128 PNG | **Yes** | `velo-qa/extension/icons/icon-128.png` (upload a copy separately — CWS keeps listing assets separate from the package) |
| Screenshot(s) | 1280 × 800 or 640 × 400 PNG/JPG | **Yes — at least 1, max 5** | Take one of the dashboard showing a recording, or the extension popup |
| Small promo tile | 440 × 280 PNG/JPG | Optional | Skip for now |
| Marquee promo tile | 1400 × 560 PNG/JPG | Optional | Skip |

---

## Tab 2 — Privacy

### Single purpose description (paste verbatim)

```
Capture browser tab screen recording + console + network + user actions when the user clicks Record, then upload to the user's VeloCap account.
```

### Permission justifications

Paste each justification into the matching field:

| Permission | Justification |
|---|---|
| **`activeTab`** | Inject capture scripts into the tab the user explicitly chooses to record. |
| **`scripting`** | Register the console + network + action capture handlers on the recorded tab. |
| **`storage`** | Store the user's session token and recording preferences locally in chrome.storage. |
| **`tabs`** | Look up the active tab URL and title so the recording metadata reflects what the user captured. |
| **`tabCapture`** | Core feature — capture the tab's video stream. |
| **`desktopCapture`** | Fallback when the user wants to record the full desktop instead of a single tab. |
| **`offscreen`** | Required by Manifest V3 to run MediaRecorder. Tab capture must happen in an offscreen document. |
| **`downloads`** | Let the user download a local copy of a recording they made. |
| **Host permission `<all_urls>`** | Users need to capture bugs on any website they visit. The extension only activates when the user clicks Record on that tab. |

### Remote code
- **Are you using remote code?** → **No**
  *(everything is bundled at build time; the extension does not dynamically load external scripts)*

### Data usage disclosures

Tick **only** these:

- ☑ **Authentication information** — Clerk session token, stored locally
- ☑ **Personally identifiable information** — email and name, received from Clerk after sign-in
- ☑ **Website content** — the screen recording of the tab the user chose, plus its console and network activity

Leave **unchecked**:
- ☐ Health information
- ☐ Financial and payment information
- ☐ Location
- ☐ Personal communications
- ☐ Web history

### Three consent checkboxes (all must be checked)

- ☑ I do not sell or transfer user data to third parties outside of the approved use cases.
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL

```
https://salmon-sea-0c8c28b03.7.azurestaticapps.net/privacy.html
```

---

## Tab 3 — Distribution

| Field | Value |
|---|---|
| **Visibility** | **Unlisted** |
| **Countries / regions** | All countries (or restrict as you prefer) |
| **Pricing** | Free |
| Mature content | No |

---

## Tab 4 — Test instructions (Access → Test instructions)

Paste this verbatim after creating a dedicated reviewer account on Clerk:

```
The extension requires sign-in via Clerk.

1. After install, click the VeloCap icon in the toolbar.
2. Click "Sign in with Clerk" — this opens the VeloCap dashboard at
   https://salmon-sea-0c8c28b03.7.azurestaticapps.net/extension-auth
3. Sign in with the review account:
      Email:    <REVIEWER_EMAIL>
      Password: <REVIEWER_PASSWORD>
   Or sign up with any email — Clerk sends a verification code.
4. Once signed in, navigate to any regular website (for example,
   https://example.com or https://news.ycombinator.com).
5. Click the VeloCap icon → "Record" → interact with the page → click
   "Stop".
6. The extension uploads the recording and opens the dashboard,
   where the recorded session is viewable.

Note: Chrome does not allow screen capture on chrome:// pages, the new
tab page, or the Chrome Web Store, so the extension will refuse to
record on those URLs. This is a Chrome API restriction, not a bug.
```

### How to create the reviewer account
1. Go to the Clerk dashboard for the `firm-tapir-95` instance (same Clerk your extension uses).
2. Users → Create user
3. Email: `cws-reviewer@<your-domain-or-throwaway>.com`
4. Set a password
5. Paste email + password into the test-instructions block above before submitting.

---

## Tab 5 — Status

Read-only. After everything above is filled it should show all tabs as ✓.
If any tab shows ⚠ go back and complete it.

Then click **Submit for review** in the top-right.

---

## After submission

### Timeline
- Typical review for extensions with `tabCapture` + `desktopCapture` + `<all_urls>`: **3–14 business days**
- Extensions with sensitive APIs often get extended review (they manually check each permission justification)
- You'll get an email when approved, or if they need more info

### Common rejection reasons (and how to respond)
| Reason | Response |
|---|---|
| "Cannot sign in with the account provided" | Make sure the reviewer account exists in Clerk and the password is correct. Re-test the flow yourself. |
| "Permission X lacks justification" | Edit the Privacy tab, strengthen the justification, resubmit. |
| "Host permission `<all_urls>` is too broad" | Justify: "Users need to capture bugs on any website they visit; activation is gated by an explicit user click." |
| "Privacy policy doesn't match manifest permissions" | Re-check `/privacy.html` covers every data type the extension handles. |
| "Remote code detected" | We don't load remote code; if flagged, show them we bundle everything at build time. |

### When approved
- Grab the install URL from the dashboard (will be `https://chromewebstore.google.com/detail/velocap/<id>`)
- Share with your team via Slack/Drive
- Chrome will auto-update installs when you publish new versions

---

## Updating the extension later

Every new version requires:
1. Bump `version` in `velo-qa/extension/src/manifest.config.ts` (semver)
2. Rebuild in release mode:
   ```bash
   cd velo-qa/extension
   EXT_BUILD_MODE=release \
   VITE_API_URL=https://velocap-api-dev.greenrock-0aa61fcc.uaenorth.azurecontainerapps.io/api \
   VITE_DASHBOARD_URL=https://salmon-sea-0c8c28b03.7.azurestaticapps.net \
   pnpm run build
   cd dist && zip -qr ../../../velocap-extension-dev.zip . && cd -
   ```
3. In the CWS dashboard → Package → Upload new package
4. Update changelog in the Store listing if meaningful
5. **Submit for review** again (each version re-enters the queue; usually faster than first review)
