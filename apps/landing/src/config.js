// API base URL — auto-switches between local dev and production
window.SYNCRA_API = (function() {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  return isLocal
    ? 'http://localhost:3000/api'
    : 'https://syncra-bwd0.onrender.com/api'; // ← replace with your real production API URL
})();
