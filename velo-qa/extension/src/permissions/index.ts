const btn = document.getElementById('grant') as HTMLButtonElement;
const state = document.getElementById('state') as HTMLDivElement;

function show(msg: string, kind: 'ok' | 'err' | 'muted' = 'muted'): void {
  state.hidden = false;
  state.className = `state ${kind}`;
  state.textContent = msg;
}

async function refreshState(): Promise<void> {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' as PermissionName });
    if (p.state === 'granted') show('Microphone is enabled. You can close this tab.', 'ok');
    else if (p.state === 'denied')
      show('Microphone is currently blocked. See the reset instructions below.', 'err');
    else show('Microphone permission not granted yet — click the button above.', 'muted');
  } catch {
    // browsers that don't support the Permissions API for microphone
  }
}

btn.addEventListener('click', async () => {
  btn.disabled = true;
  show('Asking Chrome for permission…', 'muted');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    show('✓ Microphone enabled. You can close this tab and record a Jam.', 'ok');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    show(`Permission not granted: ${msg}`, 'err');
  } finally {
    btn.disabled = false;
    void refreshState();
  }
});

void refreshState();
