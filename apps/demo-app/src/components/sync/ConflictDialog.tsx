import { useEffect, useState } from 'react';
import type { LocalConflict } from 'syncra-sdk';
import { useSdk } from '../../context/sdk-context';

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
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={e => {
        if (e.target === e.currentTarget) setConflict(null);
      }}
    >
      <div className="modal conflict-modal">
        <div className="modal-header">
          <h2 className="modal-title conflict-title">
            <span className="material-symbols-outlined">warning</span>
            Sync Conflict Detected
          </h2>
        </div>
        <div className="modal-body">
          <dl className="conflict-detail">
            <dt>Record</dt>
            <dd>{conflict.recordId}</dd>
            <dt>Version conflict</dt>
            <dd>
              Client v{conflict.clientVersion} vs Server v{conflict.serverVersion}
            </dd>
            <dt>Server data (winning)</dt>
            <dd>
              <div className="conflict-code">{JSON.stringify(conflict.serverData, null, 2)}</div>
            </dd>
            <dt>Resolution</dt>
            <dd className="conflict-resolved">Last-write-wins — server data accepted</dd>
          </dl>
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={() => setConflict(null)}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
