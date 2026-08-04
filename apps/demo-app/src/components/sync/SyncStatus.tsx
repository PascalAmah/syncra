import { useEffect, useState } from 'react';
import { useSdk } from '../../context/sdk-context';

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString();
}

export function SyncStatus() {
  const sdk = useSdk();
  const [status, setStatus] = useState<'idle' | 'syncing' | 'synced' | 'failed'>('idle');
  const [online, setOnline] = useState(sdk.isOnlineState());
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [counts, setCounts] = useState({ applied: 0, rejected: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onStart = () => {
      setStatus('syncing');
      setErrorMsg(null);
    };
    const onComplete: Parameters<typeof sdk.on<'sync-complete'>>[1] = data => {
      setStatus('synced');
      setLastSync(new Date());
      setErrorMsg(null);
      if (data) setCounts({ applied: data.applied, rejected: data.rejected });
    };
    const onFailed: Parameters<typeof sdk.on<'sync-failed'>>[1] = data => {
      setStatus('failed');
      if (data?.error) setErrorMsg(data.error.message);
    };
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);

    sdk.on('sync-start', onStart);
    sdk.on('sync-complete', onComplete);
    sdk.on('sync-failed', onFailed);
    sdk.on('online', onOnline);
    sdk.on('offline', onOffline);

    return () => {
      sdk.off('sync-start', onStart);
      sdk.off('sync-complete', onComplete);
      sdk.off('sync-failed', onFailed);
      sdk.off('online', onOnline);
      sdk.off('offline', onOffline);
    };
  }, [sdk]);

  return (
    <div className="sync-bar">
      <span className={'sync-dot ' + (online ? 'online' : 'offline')} />
      <span className={online ? 'sync-text-online' : 'sync-text-offline'}>
        {online ? 'Online' : 'Offline'}
      </span>
      <span className="sync-state">
        {status === 'syncing' && <span className="sync-syncing">Syncing…</span>}
        {status === 'synced' && (
          <span className="sync-synced">
            {counts.applied > 0 || counts.rejected > 0
              ? `${counts.applied} applied${counts.rejected > 0 ? `, ${counts.rejected} conflict${counts.rejected === 1 ? '' : 's'}` : ''}`
              : 'Up to date'}
          </span>
        )}
        {status === 'failed' && <span className="sync-failed">Sync failed</span>}
        {status === 'idle' && 'Idle'}
      </span>
      {lastSync && <span className="sync-state">{formatRelativeTime(lastSync)}</span>}
      <button
        className="btn btn-ghost"
        onClick={() => sdk.sync()}
        disabled={status === 'syncing' || !online}
        title="Sync now"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
          sync
        </span>
      </button>
      {errorMsg && (
        <span className="sync-failed" style={{ fontSize: '0.7rem' }} title={errorMsg}>
          ⚠
        </span>
      )}
    </div>
  );
}
