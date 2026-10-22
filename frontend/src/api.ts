import type {
  CallDetail,
  CallListResponse,
  CallSummary,
  FinalOutcome,
  StageDefinition,
  StageResult,
  Suggestion,
} from './types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new ApiError('Could not reach CallGuide. Check that the backend is running and try again.', 0, 'network_error');
  }

  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.detail === 'string'
      ? body.detail
      : typeof body?.message === 'string'
        ? body.message
        : 'The request could not be completed. Please try again.';
    throw new ApiError(message, response.status, body?.code);
  }
  return body as T;
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  stages: () => request<StageDefinition[]>('/api/stages'),
  createCall: (input: { prospect_name?: string; company_name?: string }) =>
    request<CallSummary>('/api/calls', { method: 'POST', body: JSON.stringify(input) }),
  saveStage: (callId: string, stage: number, input: { selected_outcome: string | null; prospect_words: string; advance_to?: number }) =>
    request<StageResult>(`/api/calls/${callId}/stages/${stage}`, { method: 'PUT', body: JSON.stringify(input) }),
  closeCall: (callId: string, input: { final_outcome: FinalOutcome; next_step?: string | null; next_step_at?: string | null }) =>
    request<CallSummary>(`/api/calls/${callId}/close`, { method: 'POST', body: JSON.stringify(input) }),
  calls: (params?: { page?: number; page_size?: number; status?: string; outcome?: string; search?: string }) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) query.set(key, String(value));
    }
    return request<CallListResponse>(`/api/calls${query.size ? `?${query.toString()}` : ''}`);
  },
  call: (callId: string) => request<CallDetail>(`/api/calls/${callId}`),
  suggest: (input: {
    stage_number: number;
    prospect_words: string;
    selected_outcome?: string | null;
    conversation_context?: string | null;
  }) => request<Suggestion>('/api/ai/suggest-response', { method: 'POST', body: JSON.stringify(input) }),
};
