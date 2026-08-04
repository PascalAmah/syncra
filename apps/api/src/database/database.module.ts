import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { MigrationService } from './migration.service';

/**
 * Global module that owns the single PostgreSQL connection pool (DatabaseService)
 * and the migration runner (MigrationService). Every other module injects these
 * from here rather than declaring their own copies, which avoids multiple pools
 * and prevents premature instantiation before ConfigService is available.
 */
@Global()
@Module({
  providers: [DatabaseService, MigrationService],
  exports: [DatabaseService, MigrationService],
})
export class DatabaseModule {}
