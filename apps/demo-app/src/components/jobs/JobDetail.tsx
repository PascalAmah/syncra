import { useState } from 'react';
import type { LocalRecord } from 'syncra-sdk';
import type { Job, JobPriority, ServiceType, JobStatus } from '../../types';
import { SERVICE_TYPES, PRIORITY_LABELS, PRIORITIES, STATUSES, STATUS_LABELS } from '../../types';

interface JobDetailProps {
  record: LocalRecord;
  pendingRecordIds: Set<string>;
  onClose: () => void;
  onSaved: (job: Job) => void;
  onDelete: () => void;
}

export function JobDetail({
  record,
  pendingRecordIds,
  onClose,
  onSaved,
  onDelete,
}: JobDetailProps) {
  const baseJob = record.data as Partial<Job>;
  const [customer, setCustomer] = useState(baseJob.customer ?? '');
  const [address, setAddress] = useState(baseJob.address ?? '');
  const [serviceType, setServiceType] = useState<ServiceType>(baseJob.serviceType ?? 'Repair');
  const [priority, setPriority] = useState<JobPriority>(baseJob.priority ?? 'medium');
  const [status, setStatus] = useState<JobStatus>(baseJob.status ?? 'pending');
  const [scheduledAt, setScheduledAt] = useState(baseJob.scheduledAt?.slice(0, 16) ?? '');
  const [worker, setWorker] = useState(baseJob.worker ?? '');
  const [notes, setNotes] = useState(baseJob.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const isPending = pendingRecordIds.has(record.id);
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h2 className="modal-title">
            <span
              className="material-symbols-outlined"
              style={{ fontSize: '1.2rem', marginRight: 6 }}
            >
              edit
            </span>
            {customer || 'Job Details'}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isPending && <span className="badge badge-status-in-progress">Unsaved</span>}
            <span className={'job-sync-dot ' + (isPending ? 'pending' : 'synced')} />
            <button className="btn btn-ghost btn-sm" onClick={onClose} title="Close">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                close
              </span>
            </button>
          </div>
        </div>

        <div className="modal-body">
          {error && <div className="auth-error">{error}</div>}

          <div className="status-stepper" role="radiogroup" aria-label="Job status">
            {STATUSES.map(s => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                className={`status-step ${status === s ? 'active' : ''}`}
                onClick={() => setStatus(s)}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="job-customer">
              Customer *
            </label>
            <input
              id="job-customer"
              className="form-input"
              value={customer}
              onChange={e => setCustomer(e.target.value)}
              placeholder="e.g. Sarah Chen"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="job-address">
              Address *
            </label>
            <input
              id="job-address"
              className="form-input"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="123 Main St, City, State"
            />
          </div>

          <div className="form-row">
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="job-service">
                Service Type
              </label>
              <select
                id="job-service"
                className="form-select"
                value={serviceType}
                onChange={e => setServiceType(e.target.value as ServiceType)}
              >
                {SERVICE_TYPES.map(s => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="job-priority">
                Priority
              </label>
              <select
                id="job-priority"
                className="form-select"
                value={priority}
                onChange={e => setPriority(e.target.value as JobPriority)}
              >
                {PRIORITIES.map(p => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="job-scheduled">
              Scheduled At
            </label>
            <input
              id="job-scheduled"
              className="form-input"
              type="datetime-local"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="job-worker">
              Assigned Worker
            </label>
            <input
              id="job-worker"
              className="form-input"
              value={worker}
              onChange={e => setWorker(e.target.value)}
              placeholder="e.g. Alex Rivera"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="job-notes">
              Notes
            </label>
            <textarea
              id="job-notes"
              className="form-textarea"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any special instructions…"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button
            className="btn btn-ghost"
            onClick={onDelete}
            title="Delete job"
            style={{ color: 'var(--error)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
              delete
            </span>
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!customer.trim() || !address.trim()) {
                setError('Customer and address are required.');
                return;
              }
              setError(null);
              const updated: Job = {
                customer,
                address,
                serviceType,
                priority,
                status,
                scheduledAt,
                notes,
                worker,
              };
              onSaved(updated);
            }}
            disabled={isPending}
          >
            {isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
