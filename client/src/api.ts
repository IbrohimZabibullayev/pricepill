import axios from 'axios';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: BACKEND_URL,
});

export interface User {
  id: number;
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  phone?: string | null;
}

export interface AnalyzeResult {
  success: boolean;
  totalCount: number;
  matchedCount: number;
  notFoundCount: number;
  reportBase64: string;
}

export async function upsertUser(tg: { id: number; username?: string; firstName?: string }): Promise<User> {
  const res = await api.post<{ success: boolean; user: User }>('/users/upsert', tg);
  return res.data.user;
}

export async function getUser(telegramId: number): Promise<User | null> {
  const res = await api.get<{ success: boolean; user: User | null }>(`/users/${telegramId}`);
  return res.data.user;
}

export async function setPhone(telegramId: number, phone: string): Promise<void> {
  await api.post('/users/phone', { telegramId, phone });
}

export async function analyzePrices(data: {
  telegramId: number;
  own: { fileName: string; url: string };
  competitors: Array<{ fileName: string; url: string }>;
}): Promise<AnalyzeResult> {
  const res = await api.post<AnalyzeResult>('/analyze', data);
  return res.data;
}
