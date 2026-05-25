import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { CurrencyModule } from '../currency/currency.module';
import { PricelistService } from '../pricelist/pricelist.service';
import { MatchingService } from '../matching/matching.service';
import { ReportService } from '../report/report.service';
import { AnalysisController } from './analysis.controller';

@Module({
  imports: [UsersModule, CurrencyModule],
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
