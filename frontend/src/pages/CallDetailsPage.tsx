import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarClock, Check, Circle, Clock3, LoaderCircle, RefreshCw, Target } from 'lucide-react';
import { ApiError, api } from '../api';
import type { CallDetail, StageDefinition } from '../types';
import { formatOutcome } from '../types';

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function duration(call: CallDetail) {
  const end = call.ended_at ? new Date(call.ended_at).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - new Date(call.started_at).getTime()) / 60000));
  return minutes < 1 ? 'Under a minute' : `${minutes} min`;
}

export default function CallDetailsPage() {
  const { callId = '' } = useParams();
  const navigate = useNavigate();
  const [call, setCall] = useState<CallDetail | null>(null);
  const [stages, setStages] = useState<StageDefinition[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [loadedCall, loadedStages] = await Promise.all([api.call(callId), api.stages()]);
      setCall(loadedCall);
      setStages(loadedStages);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Call details could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [callId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="loading-panel"><LoaderCircle className="spin" size={22} /> Loading call details…</div>;
  if (error || !call) return <div className="state-panel error-panel"><div className="state-icon">!</div><h2>Couldn’t open these details</h2><p>{error || 'This call may no longer be available.'}</p><div className="inline-actions"><button className="button button-secondary" onClick={() => void load()}><RefreshCw size={14} /> Try again</button><Link className="button button-quiet" to="/history">Back to history</Link></div></div>;

  const resultByStage = new Map(call.stage_results.map((result) => [result.stage_number, result]));

  return (
    <div className="details-page">
      <Link className="back-link" to="/history"><ArrowLeft size={15} /> Back to Call History</Link>
      <div className="page-heading-row details-heading"><div><div className="eyebrow">CALL REVIEW <span className="title-separator">/</span> {call.id.slice(0, 8).toUpperCase()}</div><h1>{call.prospect_name || 'Unnamed prospect'}{call.company_name ? <span className="title-company"> at {call.company_name}</span> : null}</h1><div className="details-subrow"><span className={`status-badge ${call.status === 'in_progress' ? 'status-progress' : 'status-complete'}`}><span />{call.status === 'in_progress' ? 'In progress' : 'Completed'}</span><span><CalendarClock size={14} /> Started {formatDate(call.started_at)}</span><span><Clock3 size={14} /> {duration(call)}</span></div></div>{call.status === 'in_progress' && <button className="button button-primary" onClick={() => navigate(`/live/${call.id}`)}>Resume call <ArrowRight size={15} /></button>}</div>

      <div className="detail-summary-grid">
        <section className="surface-card summary-card"><span className="card-eyebrow">FURTHEST STAGE</span><strong className="summary-value">{call.furthest_stage_reached}<small> / 8</small></strong><span className="summary-caption">{stages.find((stage) => stage.stage_number === call.furthest_stage_reached)?.name ?? 'Call started'}</span></section>
        <section className="surface-card summary-card"><span className="card-eyebrow">FINAL OUTCOME</span><strong className="summary-outcome">{formatOutcome(call.final_outcome)}</strong><span className="summary-caption">{call.ended_at ? `Ended ${formatDate(call.ended_at)}` : 'Call has not ended'}</span></section>
        <section className="surface-card summary-card next-summary"><span className="card-eyebrow">AGREED NEXT STEP</span><strong className="summary-next">{call.next_step || 'No next step recorded'}</strong><span className="summary-caption">{call.next_step_at ? formatDate(call.next_step_at) : '—'}</span></section>
      </div>

      <section className="surface-card timeline-card">
        <div className="timeline-heading"><div><div className="card-eyebrow"><Target size={13} /> CONVERSATION TIMELINE</div><h2>Stage by stage</h2></div><span className="timeline-count">{call.stage_results.length} {call.stage_results.length === 1 ? 'stage saved' : 'stages saved'}</span></div>
        <div className="timeline-list">{stages.map((stage) => {
          const reached = stage.stage_number <= call.furthest_stage_reached;
          const result = resultByStage.get(stage.stage_number);
          return <article key={stage.stage_number} className={`timeline-item ${reached ? 'timeline-reached' : 'timeline-unreached'}`}>
            <div className="timeline-marker-column"><span className="timeline-marker">{reached ? <Check size={14} /> : <Circle size={12} />}</span>{stage.stage_number < 8 && <span className="timeline-line" />}</div>
            <div className="timeline-content"><div className="timeline-stage-head"><div><span className="timeline-stage-number">STAGE {String(stage.stage_number).padStart(2, '0')}</span><h3>{stage.name}</h3></div><span className={`timeline-reached-label ${reached ? 'is-reached' : ''}`}>{reached ? 'Reached' : 'Not reached'}</span></div>
              {result ? <><p className="timeline-outcome">{result.selected_outcome || 'No outcome selected'}</p><div className="verbatim-quote">{result.prospect_words ? <q>{result.prospect_words}</q> : <span className="muted-text">No prospect words saved for this stage.</span>}</div><span className="timeline-time">{result.completed_at ? `Saved ${formatDate(result.completed_at)}` : 'Saved without a timestamp'}</span></> : reached ? <p className="timeline-empty-note">This stage was reached; no stage notes were saved.</p> : <p className="timeline-empty-note">The call ended before this stage.</p>}
            </div>
          </article>;
        })}</div>
      </section>
    </div>
  );
}
