import { IsNotEmpty, IsObject } from 'class-validator';

export class CreateRecordDto {
  @IsObject({ message: 'data must be an object' })
  @IsNotEmpty({ message: 'data is required' })
  data: Record<string, any>;
}
