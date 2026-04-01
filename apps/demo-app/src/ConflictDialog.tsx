import { useEffect, useState } from 'react';
import type { LocalConflict } from 'syncra-sdk';
import { useSdk } from './sdk-context';

export function ConflictDialog() {
  const sdk = useSdk();
  const [conflict, setConflict] = useState<LocalConflict | null>(null);

  useEffect(() => {
    const onConflict = (c: LocalConflict) => setConflict(c);
    sdk.on('conflict', onConflict);
    return () => sdk.off('conflict', onConflict);
  }, [sdk]);

  if (!conflict) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          maxWidth: 480,
          width: '90%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        }}
      >
        <h2
          id="conflict-dialog-title"
          style={{ margin: '0 0 12px', fontSize: 18, color: '#b45309' }}
        >
          ⚠ Sync Conflict Detected
        </h2>

        <dl style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.7 }}>
          <dt style={{ fontWeight: 600, color: '#555' }}>Record ID</dt>
          <dd style={{ margin: '0 0 8px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
            {conflict.recordId}
          </dd>

          <dt style={{ fontWeight: 600, color: '#555' }}>Version conflict</dt>
          <dd style={{ margin: '0 0 8px' }}>
            Client v{conflict.clientVersion} → Server v{conflict.serverVersion}
          </dd>

          <dt style={{ fontWeight: 600, color: '#555' }}>Server data (winning version)</dt>
          <dd
            style={{
              margin: '0 0 8px',
              background: '#f5f5f5',
              borderRadius: 4,
              padding: '6px 10px',
              fontFamily: 'monospace',
              fontSize: 13,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {JSON.stringify(conflict.serverData, null, 2)}
          </dd>

          <dt style={{ fontWeight: 600, color: '#555' }}>Resolution applied</dt>
          <dd style={{ margin: 0, color: '#16a34a' }}>
            Last-write-wins — server data accepted
          </dd>
        </dl>

        <button
          onClick={() => setConflict(null)}
          style={{
            padding: '7px 18px',
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 14,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

