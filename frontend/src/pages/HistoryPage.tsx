import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Clock3, LoaderCircle, Phone, RefreshCw, Search } from 'lucide-react';
import { ApiError, api } from '../api';
import type { CallListResponse, CallSummary } from '../types';
import { formatOutcome } from '../types';

function dateLabel(value: string) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function initials(name: string | null) {
  return (name || 'P').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
}

function CallRow({ call }: { call: CallSummary }) {
  const navigate = useNavigate();
  return (
    <tr className="history-row" onDoubleClick={() => navigate(`/calls/${call.id}`)}>
      <td><div className="prospect-cell"><span className="prospect-avatar">{initials(call.prospect_name)}</span><span className="prospect-meta"><strong>{call.prospect_name || 'Unnamed prospect'}</strong><small>{call.company_name || 'Company not added'}</small></span></div></td>
      <td><div className="date-cell"><CalendarDays size={14} /><span>{dateLabel(call.started_at)}</span></div></td>
      <td><span className="stage-pill">Stage {call.furthest_stage_reached} <span>of 8</span></span></td>
      <td>{call.final_outcome ? <span className="outcome-text">{formatOutcome(call.final_outcome)}</span> : <span className="muted-text">—</span>}</td>
      <td>{call.next_step ? <span className="next-step-cell" title={call.next_step}>{call.next_step}</span> : <span className="muted-text">—</span>}</td>
      <td><span className={`status-badge ${call.status === 'in_progress' ? 'status-progress' : 'status-complete'}`}><span />{call.status === 'in_progress' ? 'In progress' : 'Completed'}</span></td>
      <td><div className="row-actions"><Link to={`/calls/${call.id}`} className="row-link">Details <ArrowRight size={14} /></Link>{call.status === 'in_progress' && <Link to={`/live/${call.id}`} className="resume-link">Resume</Link>}</div></td>
    </tr>
  );
}

export default function HistoryPage() {
  const [data, setData] = useState<CallListResponse | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [outcome, setOutcome] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 15;

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      api.calls({ page, page_size: pageSize, search: search.trim(), status, outcome })
        .then((result) => { if (current) { setData(result); setError(''); } })
        .catch((reason) => { if (current) setError(reason instanceof ApiError ? reason.message : 'Call history could not be loaded.'); })
        .finally(() => { if (current) setLoading(false); });
    }, search ? 200 : 0);
    return () => { current = false; window.clearTimeout(timer); };
  }, [page, pageSize, search, status, outcome]);

  function changeFilter(kind: 'status' | 'outcome', value: string) {
    setPage(1);
    if (kind === 'status') setStatus(value);
    else setOutcome(value);
  }

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));

  return (
    <div className="history-page">
      <div className="page-heading-row"><div><div className="eyebrow">YOUR CONVERSATIONS</div><h1>Call History</h1><p className="page-subtitle">A clear record of what was said, where each call ended, and what comes next.</p></div><span className="history-count">{data ? `${data.total} ${data.total === 1 ? 'call' : 'calls'}` : '—'}</span></div>
      <section className="surface-card history-card">
        <div className="history-toolbar">
          <label className="search-field"><Search size={16} /><input aria-label="Search by prospect or company" placeholder="Search prospect or company" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /><kbd>/</kbd></label>
          <div className="filter-controls"><label className="sr-only" htmlFor="history-status">Filter by status</label><select id="history-status" className="filter-select" value={status} onChange={(event) => changeFilter('status', event.target.value)}><option value="">All statuses</option><option value="in_progress">In progress</option><option value="completed">Completed</option></select><label className="sr-only" htmlFor="history-outcome">Filter by outcome</label><select id="history-outcome" className="filter-select" value={outcome} onChange={(event) => changeFilter('outcome', event.target.value)}><option value="">All outcomes</option><option value="meeting_booked">Meeting booked</option><option value="callback_agreed">Callback agreed</option><option value="information_sent">Information to send</option><option value="not_interested">Not interested</option><option value="no_next_step">No next step</option><option value="other">Other</option></select></div>
        </div>
        {loading ? <div className="table-state"><LoaderCircle className="spin" size={21} /><span>Loading calls…</span></div> : error ? <div className="table-state error-panel"><div className="state-icon">!</div><h3>Call history is unavailable</h3><p>{error}</p><button className="button button-secondary" onClick={async () => { setLoading(true); setError(''); try { setData(await api.calls({ page, page_size: pageSize, search: search.trim(), status, outcome })); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Call history could not be loaded.'); } finally { setLoading(false); } }}><RefreshCw size={14} /> Retry</button></div> : data?.items.length ? <>
          <div className="table-scroll"><table className="history-table"><thead><tr><th>PROSPECT</th><th>STARTED</th><th>FURTHEST STAGE</th><th>FINAL OUTCOME</th><th>NEXT STEP</th><th>STATUS</th><th aria-label="Actions" /></tr></thead><tbody>{data.items.map((call) => <CallRow key={call.id} call={call} />)}</tbody></table></div>
          <div className="pagination"><span>Showing {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, data.total)} of {data.total}</span><div className="pagination-buttons"><button className="icon-button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page"><ChevronLeft size={17} /></button><span>Page {page} of {totalPages}</span><button className="icon-button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} aria-label="Next page"><ChevronRight size={17} /></button></div></div>
        </> : <div className="empty-history"><div className="empty-icon"><Phone size={19} /></div><h2>{search || status || outcome ? 'No matching calls' : 'Your conversations start here'}</h2><p>{search || status || outcome ? 'Try another search or clear the filters.' : 'Saved calls will appear here with their stage notes and agreed next steps.'}</p>{(search || status || outcome) && <button className="button button-quiet" onClick={() => { setSearch(''); setStatus(''); setOutcome(''); setPage(1); }}>Clear filters</button>}</div>}
      </section>
      <div className="history-footnote"><Clock3 size={14} /> Furthest stage and final outcome are tracked separately.</div>
    </div>
  );
}
