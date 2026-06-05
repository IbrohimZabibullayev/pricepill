import axios from 'axios';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000/api';

const api = axios.create({
  baseURL: BACKEND_URL,
});

// Backend xatolarining tafsilotini ochib beramiz. Axios standart `error.message`
// faqat «Request failed with status code 500» deydi — backend yuborgan o'zbekcha
// izoh (masalan «kerakli ustunlar topilmadi») esa `response.data.message` da yotadi.
api.interceptors.response.use(
  (res) => res,
  (error) => {
    const backendMsg =
      error.response?.data?.message ?? error.response?.data?.error;
    if (backendMsg) {
      error.message = typeof backendMsg === 'string' ? backendMsg : String(backendMsg);
    }
    return Promise.reject(error);
  },
);

export interface User {
  id: number;
  telegramId: number;
  username?: string | null;
  firstName?: string | null;
  phone?: string | null;
}

/** /analyze POST javobi — tahlil boshlandi, jobId qaytadi. */
export interface StartResult {
  success: boolean;
  jobId: string;
}

/** /analyze/:jobId GET javobi — tahlil holati. */
export interface StatusResult {
  success: boolean;
  status: 'processing' | 'done' | 'error';
  totalCount?: number;
  matchedCount?: number;
  notFoundCount?: number;
  reportBase64?: string;
  message?: string;
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

/** Tahlilni BOSHLAYDI — darrov jobId qaytadi (so'rov qisqa, proxy uzmaydi). */
export async function startAnalysis(data: {
  telegramId: number;
  own: { fileName: string; url: string };
  competitors: Array<{ fileName: string; url: string }>;
}): Promise<StartResult> {
  const res = await api.post<StartResult>('/analyze', data);
  return res.data;
}

/** Tahlil holatini so'raydi (client buni qisqa intervalda takrorlab turadi). */
export async function getAnalysisStatus(jobId: string): Promise<StatusResult> {
  const res = await api.get<StatusResult>(`/analyze/${jobId}`);
  return res.data;
}
