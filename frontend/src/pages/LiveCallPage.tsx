import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Clock3, Copy, Lightbulb, LoaderCircle, MessageSquareText, Phone, PhoneOff, RefreshCw, Sparkles, Target } from 'lucide-react';
import { ApiError, api } from '../api';
import EndCallDialog from '../components/EndCallDialog';
import type { CallDetail, FinalOutcome, SaveStatus, StageDefinition, StageResult, Suggestion } from '../types';

type Draft = { selected_outcome: string | null; prospect_words: string };
const emptyDraft = (): Draft => ({ selected_outcome: null, prospect_words: '' });

function formatElapsed(startedAt: string, now: number) {
  const total = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function stageStatus(stageNumber: number, active: number, furthest: number) {
  if (stageNumber === active) return 'current';
  if (stageNumber < active || stageNumber <= furthest) return 'reached';
  return 'upcoming';
}

export default function LiveCallPage() {
  const { callId = '' } = useParams();
  const navigate = useNavigate();
  const [call, setCall] = useState<CallDetail | null>(null);
  const [stages, setStages] = useState<StageDefinition[]>([]);
  const [activeStage, setActiveStage] = useState(1);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [saveStates, setSaveStates] = useState<Record<number, SaveStatus>>({});
  const revisions = useRef<Record<number, number>>({});
  const [loadError, setLoadError] = useState('');
  const [stageError, setStageError] = useState('');
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [endOpen, setEndOpen] = useState(false);
  const [endBusy, setEndBusy] = useState(false);
  const [endError, setEndError] = useState('');
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestionError, setSuggestionError] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const [loadedCall, loadedStages] = await Promise.all([api.call(callId), api.stages()]);
      if (loadedCall.status === 'completed') {
        navigate(`/calls/${callId}`, { replace: true });
        return;
      }
      setCall(loadedCall);
      setStages(loadedStages);
      setActiveStage(loadedCall.current_stage);
      const nextDrafts: Record<number, Draft> = {};
      const nextStates: Record<number, SaveStatus> = {};
      for (let stage = 1; stage <= 8; stage += 1) {
        const result = loadedCall.stage_results.find((item) => item.stage_number === stage);
        nextDrafts[stage] = result
          ? { selected_outcome: result.selected_outcome, prospect_words: result.prospect_words }
          : emptyDraft();
        nextStates[stage] = result ? 'saved' : 'unsaved';
      }
      setDrafts(nextDrafts);
      setSaveStates(nextStates);
      revisions.current = {};
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : 'CallGuide could not load this call.');
    }
  }, [callId, navigate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeDefinition = useMemo(() => stages.find((stage) => stage.stage_number === activeStage), [stages, activeStage]);
  const activeDraft = drafts[activeStage] ?? emptyDraft();
  const savedResult = call?.stage_results.find((item) => item.stage_number === activeStage);
  const furthest = call?.furthest_stage_reached ?? 1;

  function updateDraft(field: keyof Draft, value: string | null) {
    revisions.current[activeStage] = (revisions.current[activeStage] ?? 0) + 1;
    setDrafts((current) => ({
      ...current,
      [activeStage]: { ...(current[activeStage] ?? emptyDraft()), [field]: value },
    }));
    setSaveStates((current) => ({ ...current, [activeStage]: 'unsaved' }));
    setSuggestion(null);
    setSuggestionError('');
  }

  async function persistStage(stageNumber: number, advanceTo?: number): Promise<boolean> {
    const draft = drafts[stageNumber] ?? emptyDraft();
    const revision = revisions.current[stageNumber] ?? 0;
    setSaving(true);
    setStageError('');
    setSaveStates((current) => ({ ...current, [stageNumber]: 'saving' }));
    try {
      const result: StageResult = await api.saveStage(callId, stageNumber, {
        selected_outcome: draft.selected_outcome,
        prospect_words: draft.prospect_words,
        ...(advanceTo !== undefined ? { advance_to: advanceTo } : {}),
      });
      setCall((current) => current ? {
        ...current,
        current_stage: advanceTo ?? stageNumber,
        furthest_stage_reached: Math.max(current.furthest_stage_reached, advanceTo ?? stageNumber),
        stage_results: [...current.stage_results.filter((item) => item.stage_number !== stageNumber), result],
      } : current);
      const changedWhileSaving = (revisions.current[stageNumber] ?? 0) !== revision;
      setSaveStates((current) => ({ ...current, [stageNumber]: changedWhileSaving ? 'unsaved' : 'saved' }));
      return true;
    } catch (error) {
      setSaveStates((current) => ({ ...current, [stageNumber]: 'error' }));
      setStageError(error instanceof ApiError ? error.message : 'This stage was not saved. Your notes are still here; please retry.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveAndContinue() {
    if (!call || saving) return;
    const next = Math.min(8, activeStage + 1);
    const destination = activeStage < 8 ? next : activeStage;
    const saved = await persistStage(activeStage, destination);
    if (saved && activeStage < 8) {
      setActiveStage(next);
      setSuggestion(null);
      setSuggestionError('');
    }
  }

  async function finishCall(input: { final_outcome: FinalOutcome; next_step?: string; next_step_at?: string }) {
    if (!call || endBusy) return;
    setEndBusy(true);
    setEndError('');
    try {
      const stageSaved = await persistStage(activeStage, activeStage);
      if (!stageSaved) {
        setEndError('Your current stage could not be saved. Retry the save before ending the call.');
        return;
      }
      await api.closeCall(callId, input);
      setEndOpen(false);
      navigate(`/calls/${callId}`, { replace: true });
    } catch (error) {
      setEndError(error instanceof ApiError ? error.message : 'The call could not be ended. Your call is still open.');
    } finally {
      setEndBusy(false);
    }
  }

  async function requestSuggestion() {
    if (!activeDefinition || suggesting) return;
    setSuggesting(true);
    setSuggestion(null);
    setSuggestionError('');
    setCopied(false);
    try {
      const result = await api.suggest({
        stage_number: activeStage,
        prospect_words: activeDraft.prospect_words,
        selected_outcome: activeDraft.selected_outcome,
      });
      setSuggestion(result);
    } catch (error) {
      setSuggestionError(error instanceof ApiError ? error.message : 'The suggestion is unavailable. You can keep going without it.');
    } finally {
      setSuggesting(false);
    }
  }

  async function copySuggestion() {
    if (!suggestion) return;
    try {
      await navigator.clipboard.writeText(suggestion.suggested_response);
      setCopied(true);
    } catch {
      setSuggestionError('Clipboard access is unavailable in this browser. You can still select and copy the text.');
    }
  }

  if (loadError) return <div className="state-panel error-panel"><div className="state-icon">!</div><h2>Couldn’t open this call</h2><p>{loadError}</p><div className="inline-actions"><button className="button button-secondary" onClick={() => void load()}><RefreshCw size={15} /> Try again</button><button className="button button-quiet" onClick={() => navigate('/history')}>Back to history</button></div></div>;
  if (!call || !activeDefinition) return <div className="loading-panel"><LoaderCircle className="spin" size={22} /> Loading call…</div>;

  const state = saveStates[activeStage] ?? 'unsaved';
  const statusText: Record<SaveStatus, string> = { saved: 'Saved', saving: 'Saving…', unsaved: savedResult ? 'Unsaved changes' : 'Not saved yet', error: 'Save failed' };

  return (
    <div className="live-page">
      <div className="live-title-row">
        <div><div className="eyebrow"><span className="live-pulse" /> LIVE CALL <span className="title-separator">/</span> {formatElapsed(call.started_at, now)}</div><h1>{call.prospect_name || 'New prospect'}{call.company_name ? <span className="title-company"> at {call.company_name}</span> : null}</h1><p className="page-subtitle">One conversation, one thoughtful next step.</p></div>
        <button className="button button-end" onClick={() => { setEndError(''); setEndOpen(true); }}><PhoneOff size={15} /> End call</button>
      </div>

      <section className="call-strip">
        <div className="call-strip-avatar"><Phone size={18} /></div>
        <div className="call-strip-copy"><strong>{call.prospect_name || 'Prospect not named'}</strong><span>{call.company_name || 'Company not added'}</span></div>
        <div className="call-strip-stat"><span className="status-dot" /> In progress</div>
        <div className="call-strip-stat timer-stat"><Clock3 size={14} /> {formatElapsed(call.started_at, now)}</div>
        <div className="call-strip-divider" />
        <div className="call-strip-progress"><span>Stage {activeStage} of 8</span><div className="progress-track"><div style={{ width: `${(activeStage / 8) * 100}%` }} /></div></div>
      </section>

      <div className="stage-sequence" aria-label="Call stages">
        {stages.map((stage) => {
          const status = stageStatus(stage.stage_number, activeStage, furthest);
          const canVisit = stage.stage_number <= furthest + 1;
          return <button key={stage.stage_number} type="button" className={`sequence-item ${stage.stage_number === activeStage ? 'current' : ''} ${status === 'reached' ? 'reached' : ''}`} onClick={() => canVisit && setActiveStage(stage.stage_number)} disabled={!canVisit || saving} aria-current={stage.stage_number === activeStage ? 'step' : undefined} aria-label={`Stage ${stage.stage_number}: ${stage.name}${status === 'current' ? ', current' : status === 'reached' ? ', reached' : ', upcoming'}`}>
            <span className="sequence-marker">{status === 'reached' && stage.stage_number !== activeStage ? <Check size={13} /> : String(stage.stage_number).padStart(2, '0')}</span><span className="sequence-name">{stage.name}</span>
          </button>;
        })}
      </div>

      <div className="live-grid">
        <aside className="guidance-column">
          <section className="surface-card objective-card">
            <div className="card-eyebrow"><Target size={14} /> STAGE OBJECTIVE</div>
            <h2>{activeDefinition.name}</h2>
            <p>{activeDefinition.purpose}</p>
            <div className="talk-track"><span className="quote-mark">“</span><span>{activeDefinition.talk_track}</span></div>
          </section>
          <section className="surface-card listen-card">
            <div className="card-heading"><div><div className="card-eyebrow">KEEP AN EAR OUT FOR</div><h3>Possible replies</h3></div><MessageSquareText size={17} className="subtle-icon" /></div>
            <ul className="pattern-list">{activeDefinition.response_patterns.map((pattern) => <li key={pattern}><span className="list-dot" />{pattern}</li>)}</ul>
            <p className="quiet-caption">Examples to help you listen. Every conversation is different.</p>
          </section>
        </aside>

        <section className="surface-card stage-editor">
          <div className="editor-topline"><div><div className="card-eyebrow">STAGE {String(activeStage).padStart(2, '0')} <span className="title-separator">·</span> {activeDefinition.name.toUpperCase()}</div><h2>What happened at this stage?</h2></div><span className={`save-status save-${state}`}><span className="save-status-dot" />{statusText[state]}</span></div>
          <div className="outcome-section"><div className="field-heading"><span className="field-label">Choose an outcome</span><span className="field-optional">Choose one if it fits</span></div><div className="outcome-grid">{activeDefinition.outcome_options.map((option) => <button key={option} className={`outcome-chip ${activeDraft.selected_outcome === option ? 'selected' : ''}`} type="button" onClick={() => updateDraft('selected_outcome', activeDraft.selected_outcome === option ? null : option)} aria-pressed={activeDraft.selected_outcome === option}><span className="chip-check">{activeDraft.selected_outcome === option ? <Check size={12} /> : <Circle size={11} />}</span>{option}</button>)}</div></div>
          <div className={`verbatim-section ${activeStage === 5 ? 'verbatim-priority' : ''}`}><div className="field-heading"><label className="field-label" htmlFor="prospect-words">Prospect’s exact words</label><span className="field-optional">Keep their words as they said them</span></div><textarea id="prospect-words" className="verbatim-input" value={activeDraft.prospect_words} onChange={(event) => updateDraft('prospect_words', event.target.value)} maxLength={5000} placeholder="Capture what you heard, in their words…" /><div className="textarea-footer"><span>Notes are saved when you continue or end the call.</span><span>{activeDraft.prospect_words.length} / 5,000</span></div></div>
          {stageError && <div className="inline-error stage-error" role="alert">{stageError}</div>}
          <div className="editor-footer"><button className="button button-quiet" onClick={() => setActiveStage((stage) => Math.max(1, stage - 1))} disabled={activeStage === 1 || saving}><ArrowLeft size={15} /> Previous stage</button><button className="button button-primary" onClick={() => void saveAndContinue()} disabled={saving}>{saving ? <><LoaderCircle className="spin" size={15} /> Saving…</> : activeStage === 8 ? 'Save stage' : 'Save & continue'} {!saving && <ArrowRight size={15} />}</button></div>
          <div className="next-hint">{activeStage < 8 ? <>UP NEXT <span>{String(activeStage + 1).padStart(2, '0')} · {stages[activeStage]?.name}</span></> : <>FINAL STAGE <span>End the call whenever you’re ready</span></>}</div>
        </section>

        <aside className="assistant-column">
          <section className="surface-card assistant-card">
            <div className="assistant-title"><div className="assistant-icon"><Sparkles size={16} /></div><div><div className="card-eyebrow">OPTIONAL SUPPORT</div><h3>Suggest a response</h3></div></div>
            <p className="assistant-intro">Get a concise idea based on what they just said. You decide whether to use it.</p>
            {!suggestion && !suggesting && <button className="button button-outline suggest-button" onClick={() => void requestSuggestion()} disabled={!activeDraft.prospect_words.trim()}><Sparkles size={15} /> Suggest a response</button>}
            {suggesting && <div className="suggestion-loading"><LoaderCircle className="spin" size={17} /><span>Finding a natural way forward…</span></div>}
            {suggestionError && <div className="ai-error" role="status"><strong>Suggestion unavailable</strong><span>{suggestionError}</span><button className="text-button" onClick={() => void requestSuggestion()} disabled={suggesting || !activeDraft.prospect_words.trim()}>Try again</button></div>}
            {suggestion && <div className="suggestion-result"><div className="suggestion-label"><Lightbulb size={14} /> A possible response</div><blockquote>“{suggestion.suggested_response}”</blockquote>{suggestion.follow_up_question && <div className="follow-up"><span>THEN, IF IT FEELS RIGHT</span><p>“{suggestion.follow_up_question}”</p></div>}<p className="suggestion-reason">{suggestion.reasoning}</p><button className="button button-secondary copy-button" onClick={() => void copySuggestion()}><Copy size={14} /> {copied ? 'Copied' : 'Copy response'}</button><button className="text-button regenerate-button" onClick={() => void requestSuggestion()} disabled={suggesting}><RefreshCw size={13} /> Regenerate</button></div>}
            <div className="ai-footnote"><span>AI suggestions can be imperfect.</span><span>Your notes and choices stay unchanged.</span></div>
          </section>
          <section className="surface-card call-note-card"><div className="card-eyebrow">A SMALL REMINDER</div><p>Listen first. A pause can be more useful than the perfect line.</p><div className="reminder-flourish">—</div></section>
          {savedResult?.completed_at && <div className="last-saved"><CheckCircle2 size={14} /> Last saved {new Date(savedResult.completed_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>}
        </aside>
      </div>
      <EndCallDialog open={endOpen} onClose={() => setEndOpen(false)} onConfirm={finishCall} busy={endBusy || saving} error={endError} />
    </div>
  );
}
