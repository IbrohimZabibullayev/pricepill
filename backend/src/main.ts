import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('PricePill-Backend');
  const app = await NestFactory.create(AppModule);
  
  app.setGlobalPrefix('api');
  
  // Enable CORS so that client can connect easily
  app.enableCors();

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🟢 PricePill REST API running on port ${port}`);

  // Railway/process shutdown cleanup
  const shutdown = async () => {
    logger.log('🔴 Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

bootstrap();
