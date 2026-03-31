import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { OperationDto } from './dto/sync.dto';
import { SyncService, ProcessSyncResult } from './sync.service';

export interface SyncJob {
  userId: string;
  operations: OperationDto[];
  timestamp: number;
}

export type JobStatus = 'queued' | 'active' | 'completed' | 'failed' | 'unknown';

export interface JobStatusResult {
  jobId: string;
  status: JobStatus;
  result?: ProcessSyncResult;
  failedReason?: string;
}

const QUEUE_NAME = 'sync-operations';

@Injectable()
export class SyncQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncQueueService.name);
  private connection: IORedis;
  queue: Queue<SyncJob>;
  private worker: Worker<SyncJob, ProcessSyncResult>;

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => SyncService))
    private readonly syncService: SyncService,
  ) {}

  onModuleInit() {
    const redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
    this.connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

    this.queue = new Queue<SyncJob>(QUEUE_NAME, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    });

    this.worker = new Worker<SyncJob, ProcessSyncResult>(
      QUEUE_NAME,
      async (job: Job<SyncJob>) => {
        this.logger.debug(`Processing job ${job.id} for user ${job.data.userId}`);
        const { userId, operations } = job.data;
        return this.syncService.processOperations(userId, operations);
      },
      {
        connection: this.connection,
        concurrency: 10,
        lockDuration: 30000,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.debug(`Job ${job.id} completed`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
    });
  }

  async enqueue(data: SyncJob): Promise<string> {
    const job = await this.queue.add('sync', data);
    return job.id!;
  }

  async getJobStatus(jobId: string): Promise<JobStatusResult> {
    const job = await this.queue.getJob(jobId);

    if (!job) {
      return { jobId, status: 'unknown' };
    }

    const state = await job.getState();

    if (state === 'completed') {
      return {
        jobId,
        status: 'completed',
        result: job.returnvalue as ProcessSyncResult,
      };
    }

    if (state === 'failed') {
      return {
        jobId,
        status: 'failed',
        failedReason: job.failedReason,
      };
    }

    if (state === 'active') {
      return { jobId, status: 'active' };
    }

    return { jobId, status: 'queued' };
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    await this.connection?.quit();
  }
}
