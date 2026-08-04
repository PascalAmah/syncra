// ── Footer year ──
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('footer-year');
  if (el) el.textContent = new Date().getFullYear();
});

// ── Page loader ──
function hideLoader() {
  const loader = document.getElementById('page-loader');
  if (!loader) return;
  loader.classList.add('fade-out');
  setTimeout(() => loader.remove(), 320);
}
window.hideLoader = hideLoader;

// Auto-hide on DOMContentLoaded for public pages (no auth needed)
document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.dataset.protected) hideLoader();
});

// ── Copy install command ──
// Copies `npm install syncra-sdk` to the clipboard and swaps the clicked
// pill's copy icon to a checkmark for ~1.8s as feedback. Works for any pill
// that calls copyInstall(this) and contains a [data-copy-icon] element.
function copyInstall(el) {
  navigator.clipboard.writeText('npm install syncra-sdk').then(() => {
    if (!el) return;
    const icon = el.querySelector('[data-copy-icon]');
    if (!icon) return;
    icon.textContent = 'check';
    icon.classList.add('text-primary');
    setTimeout(() => {
      icon.textContent = 'content_copy';
      icon.classList.remove('text-primary');
    }, 1800);
  }).catch(() => {});
}
window.copyInstall = copyInstall;

// ── Mobile menu toggle ──
function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  if (menu) menu.classList.toggle('open');
}
window.toggleMobileMenu = toggleMobileMenu;

// ── URL helper: always use clean paths (Vite dev server + Vercel both handle rewrites) ──
function url(cleanPath) {
  return cleanPath;
}
window.url = url;

// ── Scroll reveal ──
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll('.reveal, .reveal-stagger').forEach((el) => {
  observer.observe(el);
});
