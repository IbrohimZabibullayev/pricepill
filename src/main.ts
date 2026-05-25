import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('PricePill');
  // Botni HTTP server'siz, faqat long-polling rejimida ishlatamiz.
  const app = await NestFactory.createApplicationContext(AppModule);
  await app.init();
  logger.log('🟢 PricePill bot ishga tushdi (long-polling).');

  // Railway/process to'xtaganda toza yopilish.
  const shutdown = async () => {
    logger.log('🔴 To‘xtatilmoqda...');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

bootstrap();
