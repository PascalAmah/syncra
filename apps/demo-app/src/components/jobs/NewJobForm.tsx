import { useState } from 'react';
import type { Job, JobPriority, ServiceType } from '../../types';
import { SERVICE_TYPES, PRIORITY_LABELS, PRIORITIES, makeJob } from '../../types';
import { useSdk } from '../../context/sdk-context';

interface NewJobFormProps {
  worker: string;
  onClose: () => void;
}

export function NewJobForm({ worker, onClose }: NewJobFormProps) {
  const sdk = useSdk();
  const [customer, setCustomer] = useState('');
  const [address, setAddress] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType>('Repair');
  const [priority, setPriority] = useState<JobPriority>('medium');
  const [scheduledAt, setScheduledAt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!customer.trim() || !address.trim() || !scheduledAt) {
      setError('Please fill in customer, address, and scheduled time.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const job: Job = makeJob({
        customer,
        address,
        serviceType,
        priority,
        scheduledAt: new Date(scheduledAt).toISOString().slice(0, 16),
        notes,
        worker,
      });
      await sdk.createRecord(job, 'jobs');
      sdk.sync().catch(() => {});
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create job');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ maxWidth: 520 }}>
        <form onSubmit={handleSubmit}>
          <div className="modal-header">
            <h2 className="modal-title">
              <span
                className="material-symbols-outlined"
                style={{ fontSize: '1.2rem', marginRight: 6 }}
              >
                add
              </span>
              New Job
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} title="Close">
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                close
              </span>
            </button>
          </div>

          <div className="modal-body">
            {error && <div className="auth-error">{error}</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="new-customer">
                Customer *
              </label>
              <input
                id="new-customer"
                className="form-input"
                value={customer}
                onChange={e => setCustomer(e.target.value)}
                placeholder="e.g. Sarah Chen"
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="new-address">
                Address *
              </label>
              <input
                id="new-address"
                className="form-input"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="123 Main St, City, State"
              />
            </div>

            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="new-service">
                  Service Type
                </label>
                <select
                  id="new-service"
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
                <label className="form-label" htmlFor="new-priority">
                  Priority
                </label>
                <select
                  id="new-priority"
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
              <label className="form-label" htmlFor="new-scheduled">
                Scheduled At *
              </label>
              <input
                id="new-scheduled"
                className="form-input"
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="new-notes">
                Notes
              </label>
              <textarea
                id="new-notes"
                className="form-textarea"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Any special instructions…"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
