import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { PricelistService } from '../pricelist/pricelist.service';
import { MatchingService } from '../matching/matching.service';
import { ReportService } from '../report/report.service';
import { SessionService } from './session.service';
import { BotUpdate } from './bot.update';
import { CurrencyModule } from '../currency/currency.module';

@Module({
  imports: [UsersModule, CurrencyModule],
  providers: [
    BotUpdate,
    SessionService,
    PricelistService,
    MatchingService,
    ReportService,
  ],
})
export class BotModule {}
