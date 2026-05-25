export interface UploadedFile {
  fileId: string;
  fileName: string;
}

export interface SessionState {
  step: 'idle' | 'awaiting_phone' | 'awaiting_own' | 'awaiting_competitors';
  own: UploadedFile | null;
  competitors: UploadedFile[];
}

export class SessionManager {
  private readonly store = new Map<number, SessionState>();

  get(userId: number): SessionState {
    let s = this.store.get(userId);
    if (!s) {
      s = this.defaultState();
      this.store.set(userId, s);
    }
    return s;
  }

  set(userId: number, update: Partial<SessionState>) {
    const s = this.get(userId);
    Object.assign(s, update);
  }

  reset(userId: number) {
    this.store.set(userId, this.defaultState());
  }

  private defaultState(): SessionState {
    return {
      step: 'idle',
      own: null,
      competitors: [],
    };
  }
}

export const sessionManager = new SessionManager();
