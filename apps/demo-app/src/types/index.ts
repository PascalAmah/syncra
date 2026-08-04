/**
 * Field Service domain types.
 *
 * A "Job" is stored as a Syncra record in the "jobs" collection. The job
 * fields live inside the record's `data` payload; this interface describes
 * that shape so the UI can work with typed objects instead of raw
 * `Record<string, unknown>`.
 */

export type JobStatus = 'pending' | 'in-progress' | 'completed';
export type JobPriority = 'low' | 'medium' | 'high';
export type ServiceType = 'Repair' | 'Installation' | 'Inspection' | 'Maintenance';

export interface Job {
  customer: string;
  address: string;
  serviceType: ServiceType;
  status: JobStatus;
  priority: JobPriority;
  notes: string;
  scheduledAt: string; // ISO 8601 date string
  worker: string;
  /** Allow arbitrary extra fields; aligns Job with the SDK's Record<string, unknown> data. */
  [key: string]: unknown;
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  pending: 'Pending',
  'in-progress': 'In Progress',
  completed: 'Completed',
};

export const PRIORITY_LABELS: Record<JobPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const SERVICE_TYPES: ServiceType[] = ['Repair', 'Installation', 'Inspection', 'Maintenance'];
export const STATUSES: JobStatus[] = ['pending', 'in-progress', 'completed'];
export const PRIORITIES: JobPriority[] = ['low', 'medium', 'high'];

/** Builds a sample Job with sensible defaults. */
export function makeJob(partial: Partial<Job> = {}): Job {
  return {
    customer: '',
    address: '',
    serviceType: 'Repair',
    status: 'pending',
    priority: 'medium',
    notes: '',
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16), // tomorrow
    worker: '',
    ...partial,
  };
}

/** A handful of realistic demo jobs, used to seed an empty board. */
export function seedJobs(worker: string): Job[] {
  return [
    makeJob({
      customer: 'Sarah Chen',
      address: '142 Oak Street, Brooklyn NY',
      serviceType: 'Repair',
      status: 'pending',
      priority: 'high',
      notes: 'Refrigerator not cooling. Customer reports intermittent issue over 3 days.',
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString().slice(0, 16),
      worker,
    }),
    makeJob({
      customer: 'Marcus Webb',
      address: '88 Pine Avenue, Queens NY',
      serviceType: 'Installation',
      status: 'in-progress',
      priority: 'medium',
      notes: 'Install new POS terminal. Hardware delivered, awaiting network config.',
      scheduledAt: new Date(Date.now() + 7_200_000).toISOString().slice(0, 16),
      worker,
    }),
    makeJob({
      customer: 'Lina Okafor',
      address: '305 Maple Drive, Bronx NY',
      serviceType: 'Inspection',
      status: 'pending',
      priority: 'low',
      notes: 'Annual fire-safety inspection for commercial kitchen.',
      scheduledAt: new Date(Date.now() + 86_400_000 + 3_600_000).toISOString().slice(0, 16),
      worker,
    }),
    makeJob({
      customer: 'David Park',
      address: '12 Elm Court, Manhattan NY',
      serviceType: 'Maintenance',
      status: 'completed',
      priority: 'medium',
      notes: 'Quarterly HVAC maintenance. Replaced filters, checked refrigerant levels.',
      scheduledAt: new Date(Date.now() - 86_400_000).toISOString().slice(0, 16),
      worker,
    }),
  ];
}
