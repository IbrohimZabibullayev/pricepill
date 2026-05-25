import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import { PrismaModule } from './prisma/prisma.module';
import { BotModule } from './bot/bot.module';
import { CurrencyModule } from './currency/currency.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TelegrafModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const token = config.get<string>('BOT_TOKEN');
        if (!token) {
          throw new Error(
            'BOT_TOKEN topilmadi. .env faylga yangi BotFather tokenini qo‘ying.',
          );
        }
        return {
          token,
          middlewares: [session()],
        };
      },
    }),
    PrismaModule,
    CurrencyModule,
    BotModule,
  ],
})
export class AppModule {}
