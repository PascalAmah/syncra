import { useState } from 'react';

/**
 * "How to test" panel.
 *
 * Makes the demo self-explanatory: tells an evaluator what Syncra is, what
 * the UI surface means, and gives a 30-second scripted walkthrough to feel
 * offline-first syncing, conflict resolution, and delta pull.
 */
const STEPS = [
  'Create or edit a job — it is saved immediately to IndexedDB (your device), no network needed.',
  'Open DevTools → Network tab → set throttling to "Offline". Edit a job again — the card shows a yellow "Unsaved" dot and the Pending Sync count rises.',
  'Switch back to "Online" (or wait ~30s). The SDK auto-syncs: the queue flushes to the server and the local copy refreshes in the background.',
  'Force a conflict: open this demo in two browser tabs with the same account, edit the same job in both while offline, then reconnect both. The server-wins dialog appears.',
];

export function AboutPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="about-panel">
      <button className="about-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
        <span className="about-toggle-icon">▸</span>
        What am I looking at? — Syncra offline-first demo
      </button>

      {open && (
        <div className="about-body">
          <p className="about-lead">
            This is the <strong>Syncra SDK</strong> in action. Every job you see and edit is a{' '}
            <em>record</em> stored locally in <strong>IndexedDB</strong>. Writes always succeed
            instantly (offline-first), then sync to the server whenever your device is online.
          </p>

          <div className="about-grid">
            <div>
              <div className="about-heading">The status bar</div>
              <ul className="about-list">
                <li>
                  <span className="sync-dot online" style={{ display: 'inline-block' }} /> Online /
                  offline state
                </li>
                <li>Applied / conflict counts after each sync</li>
                <li>
                  <strong>Sync now</strong> button to force a push + pull
                </li>
              </ul>
            </div>
            <div>
              <div className="about-heading">On the job cards</div>
              <ul className="about-list">
                <li>
                  <span className="job-sync-dot synced" style={{ display: 'inline-block' }} /> Green
                  dot = synced to server
                </li>
                <li>
                  <span className="job-sync-dot pending" style={{ display: 'inline-block' }} />{' '}
                  Yellow pulsing dot = change waiting to sync
                </li>
              </ul>
            </div>
          </div>

          <div className="about-heading">Try it (30 seconds)</div>
          <ol className="about-steps">
            {STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
