import type { ApiResponse } from '@shorts/shared';
import { getAccessToken } from './auth-store';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getAccessToken();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const json: ApiResponse<T> | unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const errBody = json as { error?: { code: string; message: string } } | null;
    throw new ApiError(
      errBody?.error?.code ?? 'UNKNOWN_ERROR',
      errBody?.error?.message ?? `Request failed with status ${res.status}`,
    );
  }

  return json as T;
}
