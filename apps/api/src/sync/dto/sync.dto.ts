import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsObject,
  IsString,
  IsUUID,
  IsInt,
  Min,
  ValidateNested,
  IsISO8601,
} from 'class-validator';

export class OperationDto {
  @IsUUID()
  id: string;

  @IsIn(['create', 'update', 'delete'])
  type: 'create' | 'update' | 'delete';

  @IsUUID()
  recordId: string;

  @IsObject()
  payload: Record<string, any>;

  @IsInt()
  @Min(1)
  version: number;

  @IsString()
  idempotencyKey: string;
}

export class SyncRequestDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OperationDto)
  operations: OperationDto[];
}

export class SyncUpdatesQueryDto {
  @IsISO8601()
  since: string;
}

export class SyncRecordDto {
  id: string;
  data: Record<string, any>;
  version: number;
  updated_at: string;
}

export class SyncUpdatesResponseDto {
  records: SyncRecordDto[];
  deletedRecordIds: string[];
}

/**
 * Represents a successfully applied operation result in the POST /sync response.
 */
export class OperationResultDto {
  operationId: string;
  recordId: string;
  newVersion?: number;
  data?: Record<string, any>;
}

/**
 * Represents a rejected operation with full conflict details in the POST /sync response.
 * Requirement 8.1: conflict object must include recordId, clientVersion, serverVersion, serverData.
 */
export class ConflictResponseDto {
  operationId: string;
  recordId: string;
  reason: string;
  clientVersion: number;
  serverVersion: number;
  serverData: Record<string, any>;
}

/**
 * Response shape for POST /sync endpoint.
 */
export class SyncPushResponseDto {
  applied: OperationResultDto[];
  rejected: ConflictResponseDto[];
}
