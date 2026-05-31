import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PricelistService } from '../pricelist/pricelist.service';
import { MatchingService } from '../matching/matching.service';
import { ReportService } from '../report/report.service';
import { AnalysisController } from './analysis.controller';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [UsersModule, AiModule],
  controllers: [AnalysisController],
  providers: [
    PricelistService,
    MatchingService,
    ReportService,
  ],
  exports: [
    PricelistService,
    MatchingService,
    ReportService,
  ],
})
export class AnalysisModule {}

