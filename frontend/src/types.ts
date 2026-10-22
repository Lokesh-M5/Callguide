export type CallStatus = 'in_progress' | 'completed';

export type FinalOutcome =
  | 'meeting_booked'
  | 'callback_agreed'
  | 'information_sent'
  | 'not_interested'
  | 'no_next_step'
  | 'other';

export interface StageDefinition {
  stage_number: number;
  name: string;
  purpose: string;
  talk_track: string;
  response_patterns: string[];
  outcome_options: string[];
}

export interface StageResult {
  id: string;
  call_id: string;
  stage_number: number;
  selected_outcome: string | null;
  prospect_words: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallSummary {
  id: string;
  prospect_name: string | null;
  company_name: string | null;
  status: CallStatus;
  current_stage: number;
  furthest_stage_reached: number;
  final_outcome: FinalOutcome | null;
  next_step: string | null;
  next_step_at: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallDetail extends CallSummary {
  stage_results: StageResult[];
}

export interface CallListResponse {
  items: CallSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface Suggestion {
  suggested_response: string;
  follow_up_question: string;
  reasoning: string;
  next_stage_hint: string;
}

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'error';

export const OUTCOME_LABELS: Record<FinalOutcome, string> = {
  meeting_booked: 'Meeting booked',
  callback_agreed: 'Callback agreed',
  information_sent: 'Information to send',
  not_interested: 'Not interested',
  no_next_step: 'No next step',
  other: 'Other',
};

export function formatOutcome(value: string | null | undefined): string {
  if (!value) return '—';
  return OUTCOME_LABELS[value as FinalOutcome] ?? value;
}
