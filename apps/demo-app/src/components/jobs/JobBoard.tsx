import type { LocalRecord } from 'syncra-sdk';
import type { Job, JobStatus, ServiceType } from '../../types';
import { STATUS_LABELS, PRIORITY_LABELS } from '../../types';

interface JobBoardProps {
  jobs: LocalRecord[];
  pendingRecordIds: Set<string>;
  onJobSelect: (job: LocalRecord) => void;
}

function statusColor(status: JobStatus): string {
  switch (status) {
    case 'pending':
      return 'var(--warning)';
    case 'in-progress':
      return 'var(--secondary)';
    case 'completed':
      return 'var(--success)';
    default:
      return 'var(--on-surface-variant)';
  }
}

function priorityClass(priority: string): string {
  return `badge-priority-${priority}`;
}

function serviceLabel(service: ServiceType): string {
  return service;
}

export function JobBoard({ jobs, pendingRecordIds, onJobSelect }: JobBoardProps) {
  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <span className="material-symbols-outlined" style={{ fontSize: 'inherit' }}>
            work
          </span>
        </div>
        <p className="empty-state-text">
          No jobs match your current filters. Create a new job to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="job-board">
      {jobs.map(r => {
        const job = r.data as Job;
        const isPending = pendingRecordIds.has(r.id);
        return (
          <div
            key={r.id}
            className={`job-card ${isPending ? 'pending-sync' : ''}`}
            onClick={() => onJobSelect(r)}
          >
            <div className="job-card-header">
              <div className="job-customer">{job.customer || '— no customer'}</div>
              <span
                className="job-sync-dot"
                style={{
                  background: isPending ? statusColor('in-progress') : statusColor(job.status),
                }}
                title={isPending ? 'Pending sync' : job.status}
              />
            </div>

            <div className="job-badges">
              <span className="badge badge-status-in-progress">{STATUS_LABELS[job.status]}</span>
              <span className={`badge badge-service`}>{serviceLabel(job.serviceType)}</span>
              <span className={`badge ${priorityClass(job.priority)}`}>
                {PRIORITY_LABELS[job.priority]}
              </span>
            </div>

            <div className="job-meta">
              <div className="job-meta-row">
                <span className="job-meta-icon">📍</span>
                <span>{job.address}</span>
              </div>
              <div className="job-meta-row">
                <span className="job-meta-icon">👷</span>
                <span>{job.worker || 'Unassigned'}</span>
              </div>
              <div className="job-meta-row">
                <span className="job-meta-icon">📅</span>
                <span>{new Date(job.scheduledAt).toLocaleString()}</span>
              </div>
            </div>

            {job.notes && <p className="job-notes">{job.notes}</p>}
          </div>
        );
      })}
    </div>
  );
}
