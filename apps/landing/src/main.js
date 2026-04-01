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
function copyInstall() {
  navigator.clipboard.writeText('npm install @syncra/sdk').then(() => {
    const toast = document.getElementById('copy-toast');
    if (toast) {
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 2000);
    }
  });
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
