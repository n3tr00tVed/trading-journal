import { useCallback, useEffect, useState } from 'react';
import { useTrades } from './hooks/useTrades.js';
import Dashboard from './components/Dashboard.jsx';
import TradesPage from './components/TradesPage.jsx';
import TradeForm from './components/TradeForm.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import Sidebar from './components/Sidebar.jsx';
import Modal from './components/Modal.jsx';
import './styles/app.css';

const VIEWS = ['dashboard', 'trades', 'settings'];

function App() {
  const {
    trades,
    stats,
    addTrade,
    updateTrade,
    deleteTrade,
    importTrades,
    restoreTrades,
    clearAll,
    lastError,
  } = useTrades();

  const [view, setView] = useState('dashboard');
  const [form, setForm] = useState(null); // null | { mode: 'new' } | { mode: 'edit', trade }
  const [toast, setToast] = useState(null); // { message, tone }

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const openNewTrade = useCallback(() => setForm({ mode: 'new' }), []);
  const openEditTrade = useCallback((trade) => setForm({ mode: 'edit', trade }), []);
  const closeForm = useCallback(() => setForm(null), []);

  const handleSave = useCallback(
    (values) => {
      if (form?.mode === 'edit') return updateTrade(form.trade.id, values);
      return addTrade(values);
    },
    [form, addTrade, updateTrade],
  );

  const handleSavedOk = useCallback(
    (message) => {
      setForm(null);
      setToast({ message, tone: 'pos' });
    },
    [],
  );

  const navigate = useCallback((nextView) => {
    if (VIEWS.includes(nextView)) setView(nextView);
  }, []);

  return (
    <div className="layout">
      <Sidebar
        view={view}
        onNavigate={navigate}
        total={stats.total}
        openCount={stats.open}
      />

      <main className="main" id="main-content">
        {lastError ? (
          <div className="alert alert-error" role="alert">
            {lastError}
          </div>
        ) : null}

        {view === 'dashboard' && (
          <Dashboard
            stats={stats}
            trades={trades ?? []}
            onAddTrade={openNewTrade}
            onEditTrade={openEditTrade}
            onViewTrades={() => navigate('trades')}
          />
        )}

        {view === 'trades' && (
          <TradesPage
            trades={trades ?? []}
            onAdd={openNewTrade}
            onEdit={openEditTrade}
            onDelete={deleteTrade}
          />
        )}

        {view === 'settings' && (
          <SettingsPage
            stats={stats}
            trades={trades ?? []}
            importTrades={importTrades}
            restoreTrades={restoreTrades}
            clearAll={clearAll}
          />
        )}
      </main>

      {form ? (
        <Modal
          title={form.mode === 'new' ? 'Add trade' : 'Edit trade'}
          onClose={closeForm}
          width={520}
        >
          <TradeForm
            initial={form.mode === 'edit' ? form.trade : null}
            onSave={(values) => {
              const result = handleSave(values);
              if (result?.ok) {
                handleSavedOk(form.mode === 'new' ? 'Trade added.' : 'Trade updated.');
              }
              return result;
            }}
            onCancel={closeForm}
          />
        </Modal>
      ) : null}

      {toast ? (
        <div className={`toast toast-${toast.tone}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

export default App;
