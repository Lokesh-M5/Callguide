import { useState } from 'react';
import { X } from 'lucide-react';
import type { FinalOutcome } from '../types';
import { OUTCOME_LABELS } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: (value: { final_outcome: FinalOutcome; next_step?: string; next_step_at?: string }) => Promise<void>;
  busy: boolean;
  error: string;
}

const outcomes = Object.entries(OUTCOME_LABELS) as [FinalOutcome, string][];

export default function EndCallDialog({ open, onClose, onConfirm, busy, error }: Props) {
  const [outcome, setOutcome] = useState<FinalOutcome | ''>('');
  const [nextStep, setNextStep] = useState('');
  const [nextAt, setNextAt] = useState('');
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="end-call-title">
        <div className="modal-heading"><div><div className="eyebrow">WRAP UP THE CONVERSATION</div><h2 id="end-call-title">End this call?</h2></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={18} /></button></div>
        <p className="modal-copy">Choose the outcome that reflects what actually happened. You can end the call from any stage.</p>
        <form onSubmit={(event) => { event.preventDefault(); if (!outcome) return; void onConfirm({ final_outcome: outcome, next_step: nextStep.trim() || undefined, next_step_at: nextAt ? new Date(nextAt).toISOString() : undefined }); }}>
          <label className="field-label" htmlFor="final-outcome">Call outcome</label>
          <select id="final-outcome" className="text-input" value={outcome} onChange={(event) => setOutcome(event.target.value as FinalOutcome | '')} required>
            <option value="" disabled>Select an outcome</option>
            {outcomes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <label className="field-label" htmlFor="next-step">Agreed next step <span>Optional</span></label>
          <textarea id="next-step" className="text-input short-textarea" value={nextStep} onChange={(event) => setNextStep(event.target.value)} maxLength={1000} placeholder="For example: call back Thursday afternoon" />
          <label className="field-label" htmlFor="next-step-at">When <span>Optional</span></label>
          <input id="next-step-at" className="text-input" type="datetime-local" value={nextAt} onChange={(event) => setNextAt(event.target.value)} />
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Continue call</button><button type="submit" className="button button-danger" disabled={busy || !outcome}>{busy ? <><span className="spinner" /> Saving…</> : 'Save & end call'}</button></div>
        </form>
      </section>
    </div>
  );
}
