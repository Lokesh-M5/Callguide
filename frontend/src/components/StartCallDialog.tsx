import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { prospect_name?: string; company_name?: string }) => Promise<void>;
  busy: boolean;
  error: string;
}

export default function StartCallDialog({ open, onClose, onSubmit, busy, error }: Props) {
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  useEffect(() => {
    if (!open) { setName(''); setCompany(''); }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="start-call-title">
        <div className="modal-heading"><div><div className="eyebrow">A FRESH CONVERSATION</div><h2 id="start-call-title">Start a call</h2></div><button className="icon-button" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={18} /></button></div>
        <p className="modal-copy">Add a name if you like. You can fill in the rest as the conversation unfolds.</p>
        <form onSubmit={(event) => { event.preventDefault(); void onSubmit({ prospect_name: name.trim() || undefined, company_name: company.trim() || undefined }); }}>
          <label className="field-label" htmlFor="prospect-name">Prospect name <span>Optional</span></label>
          <input id="prospect-name" className="text-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Who are you speaking with?" autoFocus />
          <label className="field-label" htmlFor="company-name">Company <span>Optional</span></label>
          <input id="company-name" className="text-input" value={company} onChange={(event) => setCompany(event.target.value)} maxLength={160} placeholder="Where do they work?" />
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="modal-actions"><button type="button" className="button button-quiet" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? <><span className="spinner" /> Starting…</> : 'Begin call'} <span aria-hidden="true">→</span></button></div>
        </form>
      </section>
    </div>
  );
}
