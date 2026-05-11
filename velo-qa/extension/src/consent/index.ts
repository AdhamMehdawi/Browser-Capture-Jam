import { setConsent } from '../shared/storage.js';

document.getElementById('agree')!.addEventListener('click', async () => {
  await setConsent();
  window.close();
});

document.getElementById('decline')!.addEventListener('click', () => {
  window.close();
});
