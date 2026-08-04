import { useCallback, useEffect, useState } from 'react';
import type { LocalRecord } from 'syncra-sdk';
import type { Job } from '../types';
import { seedJobs } from '../types';
import { useSdk } from '../context/sdk-context';
import { SyncStatus } from '../components/sync/SyncStatus';
import { ConflictDialog } from '../components/sync/ConflictDialog';
import { JobBoard } from '../components/jobs/JobBoard';
import { JobDetail } from '../components/jobs/JobDetail';
import { NewJobForm } from '../components/jobs/NewJobForm';
import { AboutPanel } from '../components/sync/AboutPanel';

interface JobsPageProps {
  userEmail: string;
  onLogout: () => void;
}

export function JobsPage({ userEmail, onLogout }: JobsPageProps) {
  const sdk = useSdk();
  const [jobs, setJobs] = useState<LocalRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<LocalRecord | null>(null);
  const [isNewOpen, setIsNewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterService, setFilterService] = useState<string>('all');

  const refresh = useCallback(() => {
    setJobs(sdk.getRecords('jobs'));
  }, [sdk]);

  useEffect(() => {
    const existing = sdk.getRecords('jobs');
    if (existing.length === 0) {
      const seed = seedJobs(userEmail);
      (async () => {
        for (const job of seed) {
          try {
            await sdk.createRecord(job, 'jobs');
          } catch {}
        }
        sdk.sync().catch(() => {});
        refresh();
      })();
    }
  }, [sdk, userEmail, refresh]);

  useEffect(() => {
    refresh();
    const handlers = {
      onComplete: () => refresh(),
      onConflict: () => refresh(),
      onFailed: () => refresh(),
      onOnline: refresh,
      onOffline: refresh,
    };
    sdk.on('sync-complete', handlers.onComplete);
    sdk.on('conflict', handlers.onConflict);
    sdk.on('sync-failed', handlers.onFailed);
    sdk.on('online', handlers.onOnline);
    sdk.on('offline', handlers.onOffline);
    return () => {
      sdk.off('sync-complete', handlers.onComplete);
      sdk.off('conflict', handlers.onConflict);
      sdk.off('sync-failed', handlers.onFailed);
      sdk.off('online', handlers.onOnline);
      sdk.off('offline', handlers.onOffline);
    };
  }, [sdk, refresh]);

  const pendingOps = sdk.getPendingOperations();
  const pendingRecordIds = new Set(pendingOps.map(op => op.recordId));
  const online = sdk.isOnlineState();
  const stats = {
    pending: jobs.filter(j => (j.data as Job).status === 'pending').length,
    inProgress: jobs.filter(j => (j.data as Job).status === 'in-progress').length,
    completed: jobs.filter(j => (j.data as Job).status === 'completed').length,
    pendingSync: pendingOps.length,
  };

  const filtered = jobs.filter(r => {
    const job = r.data as Job;
    return (
      (filterStatus === 'all' || job.status === filterStatus) &&
      (filterService === 'all' || job.serviceType === filterService)
    );
  });

  async function handleSave(jobId: string, data: Job) {
    try {
      await sdk.updateRecord(jobId, data as Record<string, unknown>, 'jobs');
      refresh();
      sdk.sync().catch(() => {});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save job');
    }
  }

  async function handleDelete(jobId: string) {
    try {
      await sdk.deleteRecord(jobId, 'jobs');
      refresh();
      sdk.sync().catch(() => {});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete job');
    }
  }

  async function handleDeleteAllCompleted() {
    const completed = jobs.filter(j => (j.data as Job).status === 'completed');
    for (const r of completed) {
      try {
        await sdk.deleteRecord(r.id, 'jobs');
      } catch {}
    }
    sdk.sync().catch(() => {});
    refresh();
  }

  return (
    <div className="main-layout">
      <ConflictDialog />
      <header className="main-header">
        <div className="logo-bar">
          <span className="logo">Syncra</span>
        </div>
        <SyncStatus />
      </header>

      <main className="main-content">
        <div className="main-content-inner">
          <div className="top-bar">
            <div className="user-info">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                account_circle
              </span>
              <span className="user-name">{userEmail}</span>
            </div>
            <div className="top-actions">
              {error && (
                <span className="sync-failed" style={{ fontSize: '0.75rem' }}>
                  {error}
                </span>
              )}
              <label className="toggle">
                <input type="checkbox" hidden readOnly />
                <span className={`toggle-track`}>
                  <span className={`toggle-thumb ${online ? 'on' : ''}`} />
                </span>
                <span>{online ? 'Working online' : 'Working offline'}</span>
              </label>
              <button className="btn btn-primary" onClick={() => setIsNewOpen(true)}>
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 16, marginRight: 4 }}
                >
                  add
                </span>
                New Job
              </button>
              <button className="btn btn-ghost btn-sm" onClick={onLogout} title="Logout">
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                  logout
                </span>
              </button>
            </div>
          </div>

          {!online && (
            <div className="offline-banner">
              <span className="material-symbols-outlined">cloud_off</span>
              You are working offline. Changes will sync when you reconnect.
            </div>
          )}

          <AboutPanel />

          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{stats.pending}</div>
              <div className="stat-label">Pending</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--secondary)' }}>
                {stats.inProgress}
              </div>
              <div className="stat-label">In Progress</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--success)' }}>
                {stats.completed}
              </div>
              <div className="stat-label">Completed</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--warning)' }}>
                {stats.pendingSync}
              </div>
              <div className="stat-label">Pending Sync</div>
            </div>
          </div>

          <div className="filter-bar">
            <div className="filter-group">
              <span className="filter-label">Status:</span>
              {['all', 'pending', 'in-progress', 'completed'].map(s => (
                <button
                  key={s}
                  className={`filter-chip ${filterStatus === s ? 'active' : ''}`}
                  onClick={() => setFilterStatus(s)}
                >
                  {s === 'all'
                    ? 'All'
                    : s === 'in-progress'
                      ? 'In Progress'
                      : s === 'pending'
                        ? 'Pending'
                        : 'Completed'}
                </button>
              ))}
            </div>
            <div className="filter-group">
              <span className="filter-label">Service:</span>
              {(['all'] as string[])
                .concat(['Repair', 'Installation', 'Inspection', 'Maintenance'])
                .map(s => (
                  <button
                    key={s}
                    className={`filter-chip ${filterService === s ? 'active' : ''}`}
                    onClick={() => setFilterService(s)}
                  >
                    {s === 'all' ? 'All' : s}
                  </button>
                ))}
            </div>
            {stats.completed > 0 && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleDeleteAllCompleted}
                title="Remove all completed jobs"
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
                  cleaning_services
                </span>
                Clear Completed
              </button>
            )}
          </div>

          <JobBoard
            jobs={filtered}
            pendingRecordIds={pendingRecordIds}
            onJobSelect={setSelectedRecord}
          />
        </div>
      </main>

      {isNewOpen && <NewJobForm worker={userEmail} onClose={() => setIsNewOpen(false)} />}

      {selectedRecord && (
        <JobDetail
          record={selectedRecord}
          pendingRecordIds={pendingRecordIds}
          onClose={() => setSelectedRecord(null)}
          onSaved={async (updated: Job) => {
            await handleSave(selectedRecord.id, updated);
            setSelectedRecord(null);
          }}
          onDelete={async () => {
            await handleDelete(selectedRecord.id);
            setSelectedRecord(null);
          }}
        />
      )}
    </div>
  );
}
