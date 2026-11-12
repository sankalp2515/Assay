// Runs before the Bryntum bundle loads. A client-side component licence, not a service credential.
// Without it Bryntum runs as a trial and shows its own badge.
const key = import.meta.env.VITE_BRYNTUM_LICENSE_KEY;
if (key) {
  globalThis.bryntum = globalThis.bryntum || {};
  globalThis.bryntum.licenseKey = key;
}
