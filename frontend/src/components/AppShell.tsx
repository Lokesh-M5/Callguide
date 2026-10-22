import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AudioLines, ChevronDown, Clock3, Headphones, Menu, Plus, X } from 'lucide-react';

const pageNames: Record<string, string> = {
  '/live': 'Live Call',
  '/history': 'Call History',
};

export default function AppShell({ children, onStart }: { children: ReactNode; onStart: () => void }) {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDetails = location.pathname.startsWith('/calls/');
  const title = isDetails ? 'Call Details' : pageNames[location.pathname] ?? (location.pathname.startsWith('/live/') ? 'Live Call' : 'CallGuide');

  return (
    <div className="app-frame">
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><AudioLines size={18} strokeWidth={2.1} /></div>
          <div><div className="brand-name">CallGuide</div><div className="brand-caption">Stay with the conversation</div></div>
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={17} /></button>
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <NavLink to="/live" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setMobileOpen(false)}>
            <Headphones size={17} /><span>Live Call</span><span className="nav-shortcut">01</span>
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => `nav-link ${isActive || isDetails ? 'active' : ''}`} onClick={() => setMobileOpen(false)}>
            <Clock3 size={17} /><span>Call History</span>
          </NavLink>
        </nav>
        <button className="side-start" onClick={() => { setMobileOpen(false); onStart(); }}><Plus size={16} /> Start a call</button>
        <div className="sidebar-spacer" />
        <div className="privacy-note"><span className="privacy-icon">✳</span><div><strong>Stay present.</strong><span>Capture what matters, in their words.</span></div></div>
        <button className="profile-row" type="button" aria-label="Profile menu">
          <span className="profile-avatar">CG</span><span className="profile-copy"><strong>CallGuide workspace</strong><small>Private workspace</small></span><ChevronDown size={15} className="muted-icon" />
        </button>
      </aside>
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <main className="main-column">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button>
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{title}</strong></div>
          <div className="topbar-right"><span className="topbar-status"><span className="status-dot" /> All changes saved</span><span className="topbar-date">A quieter way to call</span></div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}
