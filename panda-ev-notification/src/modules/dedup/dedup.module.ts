import { Global, Module } from '@nestjs/common';
import { DedupService } from './dedup.service';

@Global()
@Module({
  providers: [DedupService],
  exports: [DedupService],
})
export class DedupModule {}
