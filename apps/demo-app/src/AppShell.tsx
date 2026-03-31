import { useCallback, useEffect, useState } from 'react';
import type { LocalRecord } from '@syncra/sdk';
import { useSdk } from './sdk-context';
import { SyncStatus } from './SyncStatus';
import { ConflictDialog } from './ConflictDialog';

interface AppShellProps {
  userEmail: string;
  onLogout: () => void;
}

export function AppShell({ userEmail, onLogout }: AppShellProps) {
  const sdk = useSdk();
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [newData, setNewData] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Refresh the records list from the SDK's in-memory map.
  // The SDK's initialize() populates the map from IndexedDB on startup,
  // so this is always up-to-date after any mutation.
  const refresh = useCallback(() => {
    setRecords([...sdk.getRecords()]);
  }, [sdk]);

  useEffect(() => {
    refresh();

    const onComplete = () => refresh();
    const onConflict = () => refresh();

    sdk.on('sync-complete', onComplete);
    sdk.on('conflict', onConflict);

    return () => {
      sdk.off('sync-complete', onComplete);
      sdk.off('conflict', onConflict);
    };
  }, [sdk, refresh]);

  async function handleCreate() {
    if (!newData.trim()) return;
    setError(null);
    try {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(newData);
      } catch {
        data = { text: newData };
      }
      await sdk.createRecord(data);
      setNewData('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create record');
    }
  }

  async function handleUpdate() {
    if (!editId || !editData.trim()) return;
    setError(null);
    try {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(editData);
      } catch {
        data = { text: editData };
      }
      await sdk.updateRecord(editId, data);
      setEditId(null);
      setEditData('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update record');
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      await sdk.deleteRecord(id);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete record');
    }
  }

  const pending = sdk.getPendingOperations();

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24, fontFamily: 'sans-serif' }}>
      <ConflictDialog />
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ margin: 0, flex: 1 }}>Syncra Demo</h1>
        <span style={{ fontSize: 13, color: '#555', marginRight: 12 }}>{userEmail}</span>
        <button onClick={onLogout} style={{ fontSize: 13 }}>Logout</button>
      </div>

      <div style={{ marginBottom: 20, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6 }}>
        <SyncStatus />
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '8px 10px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: 4, fontSize: 13, color: '#b91c1c' }}>
          {error}
          <button style={{ marginLeft: 8, fontSize: 12 }} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Add record form */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>New Record</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1, padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4 }}
            placeholder='{"text": "hello"} or plain text'
            value={newData}
            onChange={(e) => setNewData(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <button
            onClick={handleCreate}
            disabled={!newData.trim()}
            style={{ padding: '6px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: newData.trim() ? 'pointer' : 'not-allowed', opacity: newData.trim() ? 1 : 0.6 }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Records list */}
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>
        Records ({records.length})
        {pending.length > 0 && (
          <span style={{ marginLeft: 8, fontSize: 12, color: '#f0a500', fontWeight: 'normal' }}>
            {pending.length} pending sync
          </span>
        )}
      </h2>

      {records.length === 0 && (
        <p style={{ color: '#888', fontSize: 14 }}>No records yet. Add one above.</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {records.map((r) => {
          const isPending = pending.some((op) => op.recordId === r.id);
          return (
            <li
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                marginBottom: 6,
                background: '#fff',
                border: `1px solid ${isPending ? '#f0a500' : '#e0e0e0'}`,
                borderRadius: 6,
                opacity: isPending ? 0.85 : 1,
                transition: 'border-color 0.2s, opacity 0.2s',
              }}
            >
              {/* Sync status indicator */}
              <span
                title={isPending ? 'Pending sync' : 'Synced'}
                style={{ fontSize: 12, color: isPending ? '#f0a500' : '#22c55e', flexShrink: 0 }}
              >
                {isPending ? '⏳' : '✓'}
              </span>

              {editId === r.id ? (
                <>
                  <input
                    style={{ flex: 1, padding: '4px 8px', border: '1px solid #ccc', borderRadius: 4, fontSize: 14 }}
                    value={editData}
                    onChange={(e) => setEditData(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUpdate();
                      if (e.key === 'Escape') setEditId(null);
                    }}
                    autoFocus
                  />
                  <button
                    onClick={handleUpdate}
                    style={{ padding: '3px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditId(null)}
                    style={{ padding: '3px 10px', fontSize: 13 }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontSize: 14, wordBreak: 'break-all' }}>
                    {JSON.stringify(r.data)}
                  </span>
                  <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>v{r.version}</span>
                  <button
                    onClick={() => { setEditId(r.id); setEditData(JSON.stringify(r.data)); }}
                    style={{ padding: '3px 10px', fontSize: 13 }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    style={{ padding: '3px 10px', fontSize: 13, color: '#ef4444', border: '1px solid #ef4444', borderRadius: 4, background: 'none', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
