import { Controller, Get, Post, Body, Param, HttpException, HttpStatus } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('upsert')
  async upsert(
    @Body()
    body: {
      id: number;
      username?: string;
      firstName?: string;
    },
  ) {
    if (!body.id) {
      throw new HttpException('Telegram ID yuborilmadi.', HttpStatus.BAD_REQUEST);
    }
    const user = await this.usersService.upsertFromTelegram({
      id: Number(body.id),
      username: body.username,
      firstName: body.firstName,
    });
    return {
      success: true,
      user,
    };
  }

  @Post('phone')
  async setPhone(
    @Body()
    body: {
      telegramId: number;
      phone: string;
    },
  ) {
    if (!body.telegramId || !body.phone) {
      throw new HttpException('Ma‘lumotlar yetarli emas.', HttpStatus.BAD_REQUEST);
    }
    await this.usersService.setPhone(Number(body.telegramId), body.phone);
    return {
      success: true,
    };
  }

  @Get(':telegramId')
  async findByTelegramId(@Param('telegramId') telegramId: string) {
    const tgId = Number(telegramId);
    if (isNaN(tgId)) {
      throw new HttpException('Telegram ID noto‘g‘ri shaklda.', HttpStatus.BAD_REQUEST);
    }
    const user = await this.usersService.findByTelegramId(tgId);
    return {
      success: true,
      user,
    };
  }
}
