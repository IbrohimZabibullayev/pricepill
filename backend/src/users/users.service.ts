import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Lokal test rejimida (bazasiz) ishlatiladigan oddiy foydalanuvchi shakli.
export interface MemUser {
  id: number;
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  phone?: string | null;
}

@Injectable()
export class UsersService {
  // Baza yo'q bo'lsa shu yerda saqlanadi.
  private readonly mem = new Map<number, MemUser>();
  private nextId = 1;

  constructor(private readonly prisma: PrismaService) {}

  private get useDb(): boolean {
    return this.prisma.connected;
  }

  async upsertFromTelegram(tg: {
    id: number;
    username?: string;
    firstName?: string;
  }): Promise<MemUser> {
    if (this.useDb) {
      const u = await this.prisma.user.upsert({
        where: { telegramId: BigInt(tg.id) },
        update: { username: tg.username, firstName: tg.firstName },
        create: {
          telegramId: BigInt(tg.id),
          username: tg.username,
          firstName: tg.firstName,
        },
      });
      return { ...u, telegramId: Number(u.telegramId) };
    }

    let u = this.mem.get(tg.id);
    if (!u) {
      u = { id: this.nextId++, telegramId: tg.id, username: tg.username, firstName: tg.firstName, phone: null };
      this.mem.set(tg.id, u);
    } else {
      u.username = tg.username;
      u.firstName = tg.firstName;
    }
    return u;
  }

  async setPhone(telegramId: number, phone: string): Promise<void> {
    if (this.useDb) {
      await this.prisma.user.update({
        where: { telegramId: BigInt(telegramId) },
        data: { phone },
      });
      return;
    }
    const u = this.mem.get(telegramId);
    if (u) u.phone = phone;
  }

  async findByTelegramId(telegramId: number): Promise<MemUser | null> {
    if (this.useDb) {
      const u = await this.prisma.user.findUnique({
        where: { telegramId: BigInt(telegramId) },
      });
      return u ? { ...u, telegramId: Number(u.telegramId) } : null;
    }
    return this.mem.get(telegramId) ?? null;
  }

  async logAnalysis(data: {
    telegramId: number;
    ownFileName: string;
    competitorCount: number;
    ownProductCount: number;
    matchedCount: number;
  }): Promise<void> {
    if (!this.useDb) return; // lokal rejimda tarix saqlanmaydi
    const user = await this.prisma.user.findUnique({
      where: { telegramId: BigInt(data.telegramId) },
    });
    if (!user) return;
    await this.prisma.analysis.create({
      data: {
        userId: user.id,
        ownFileName: data.ownFileName,
        competitorCount: data.competitorCount,
        ownProductCount: data.ownProductCount,
        matchedCount: data.matchedCount,
      },
    });
  }
}
