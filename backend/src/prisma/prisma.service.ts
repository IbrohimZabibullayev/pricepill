import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  // Baza ulanmasa false bo'ladi — UsersService xotira (in-memory) rejimiga o'tadi.
  public connected = false;

  async onModuleInit() {
    try {
      await this.$connect();
      this.connected = true;
      this.logger.log('🗄️  PostgreSQL ulandi.');
    } catch {
      this.connected = false;
      this.logger.warn(
        '⚠️  Baza ulanmadi — LOKAL TEST rejimi (ma‘lumotlar xotirada, saqlanmaydi). ' +
          'Production uchun DATABASE_URL ni to‘g‘ri sozlang.',
      );
    }
  }

  async onModuleDestroy() {
    if (this.connected) await this.$disconnect();
  }
}
