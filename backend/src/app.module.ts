import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CurrencyModule } from './currency/currency.module';
import { UsersModule } from './users/users.module';
import { AnalysisModule } from './analysis/analysis.module';
import { AiModule } from './ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CurrencyModule,
    UsersModule,
    AnalysisModule,
    AiModule,
  ],
})
export class AppModule {}
