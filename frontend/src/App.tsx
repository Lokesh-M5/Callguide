import { useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { ApiError, api } from './api';
import AppShell from './components/AppShell';
import StartCallDialog from './components/StartCallDialog';
import CallDetailsPage from './pages/CallDetailsPage';
import HistoryPage from './pages/HistoryPage';
import LiveCallPage from './pages/LiveCallPage';

function StartCallPage({ onStart }: { onStart: () => void }) {
  return (
    <section className="welcome-panel">
      <div className="eyebrow"><span className="eyebrow-dot" /> READY WHEN YOU ARE</div>
      <h1>Stay with the<br /><em>conversation.</em></h1>
      <p>A calm guide for the moments that matter. Start a call, take it one stage at a time, and keep the prospect’s words in their own language.</p>
      <button className="button button-primary button-large" onClick={onStart}>Start a call <span aria-hidden="true">→</span></button>
      <div className="welcome-footnote"><span className="tiny-shield">✳</span> Your notes stay yours. Nothing is recorded automatically.</div>
    </section>
  );
}

export default function App() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [startError, setStartError] = useState('');
  const [starting, setStarting] = useState(false);

  async function startCall(input: { prospect_name?: string; company_name?: string }) {
    setStarting(true);
    setStartError('');
    try {
      const call = await api.createCall(input);
      setDialogOpen(false);
      navigate(`/live/${call.id}`);
    } catch (error) {
      setStartError(error instanceof ApiError ? error.message : 'The call could not be started. Please try again.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <AppShell onStart={() => { setStartError(''); setDialogOpen(true); }}>
      <Routes>
        <Route path="/" element={<Navigate to="/live" replace />} />
        <Route path="/live" element={<StartCallPage onStart={() => setDialogOpen(true)} />} />
        <Route path="/live/:callId" element={<LiveCallPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/calls/:callId" element={<CallDetailsPage />} />
        <Route path="*" element={<Navigate to="/live" replace />} />
      </Routes>
      <StartCallDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSubmit={startCall}
        busy={starting}
        error={startError}
      />
    </AppShell>
  );
}
