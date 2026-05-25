import { Injectable } from '@nestjs/common';

export type Step = 'idle' | 'awaiting_phone' | 'awaiting_own' | 'awaiting_competitors';

export interface UploadedFile {
  fileId: string;
  fileName: string;
}

export interface FlowState {
  step: Step;
  own?: UploadedFile;
  competitors: UploadedFile[];
}

// Suhbat holatini xotirada saqlaymiz (MVP). Qayta ishga tushganda foydalanuvchi
// /start bossa bo'ldi. Keyin Postgres/Redis'ga ko'chirsa bo'ladi.
@Injectable()
export class SessionService {
  private readonly states = new Map<number, FlowState>();

  get(userId: number): FlowState {
    let s = this.states.get(userId);
    if (!s) {
      s = { step: 'idle', competitors: [] };
      this.states.set(userId, s);
    }
    return s;
  }

  set(userId: number, patch: Partial<FlowState>) {
    const s = this.get(userId);
    Object.assign(s, patch);
    this.states.set(userId, s);
  }

  reset(userId: number) {
    this.states.set(userId, { step: 'idle', competitors: [] });
  }
}
