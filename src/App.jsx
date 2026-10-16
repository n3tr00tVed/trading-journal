import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTrades } from './hooks/useTrades.js';
import { useLivePrices } from './hooks/useLivePrices.js';
import { loadCapitals, saveCapitals } from './lib/capitalStorage.js';
import { loadRules } from './lib/rulesStorage.js';
import { isTradeOpen } from './lib/schema.js';
import { CurrencyContext } from './hooks/useCurrency.js';
import { loadCurrency, saveCurrency, loadLivePrices, saveLivePrices } from './lib/settingsStorage.js';
import { putScreenshot, deleteScreenshot, getScreenshot } from './lib/screenshots.js';
import {
  connectJournalDirectory,
  forgetDirectoryHandle,
  loadDirectoryHandle,
  supportedDirectorySync,
  verifyPermission,
  writeJournalFolder,
  readJournalTrades,
} from './lib/fileSync.js';
import Dashboard from './components/Dashboard.jsx';
import TradesPage from './components/TradesPage.jsx';
import TradeForm from './components/TradeForm.jsx';
import SettingsPage from './components/SettingsPage.jsx';
import RulesPage from './components/RulesPage.jsx';
import NewsPage from './components/NewsPage.jsx';
import CalculatorPage from './components/CalculatorPage.jsx';
import Sidebar from './components/Sidebar.jsx';
import Modal from './components/Modal.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import './styles/app.css';

const VIEWS = ['dashboard', 'trades', 'news', 'rules', 'calculator', 'settings'];
const SYNC_DEBOUNCE_MS = 800;

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

  // ---- core UI state ----
  const [view, setView] = useState('dashboard');
  const [form, setForm] = useState(null); // null | { mode: 'new' } | { mode: 'edit', trade }
  const [toast, setToast] = useState(null); // { message, tone }
  const [capitals, setCapitals] = useState(() => loadCapitals()); // { INR, USD }
  const [currency, setCurrency] = useState(() => loadCurrency());
  const [livePrices, setLivePrices] = useState(() => loadLivePrices());
  const marketCapital = capitals?.[currency] ?? null;

  // ---- live crypto prices ----
  // In-memory quotes from Binance's public API (see src/lib/marketData.js);
  // the hook no-ops entirely when there are no open crypto trades.
  const live = useLivePrices(trades, { enabled: livePrices === true });

  // ---- trades_data folder sync ----
  const syncSupported = supportedDirectorySync();
  const [dataDir, setDataDir] = useState(null); // <root>/trades_data handle
  const [syncStatus, setSyncStatus] = useState('off'); // off | connecting | on | blocked | error | unsupported
  const [syncAuto, setSyncAuto] = useState(true);
  const [syncNote, setSyncNote] = useState(null); // { message, tone } | { kind? } string

  // ---- dialogs ----
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(null);
  const [screenshotView, setScreenshotView] = useState(null); // { trade, url }

  // Reconnect a previously granted folder on mount. Async callback state
  // updates (inside promise handlers) are reactive-safe.
  useEffect(() => {
    if (!syncSupported) return undefined;
    let cancelled = false;
    loadDirectoryHandle().then(async (dir) => {
      if (cancelled || !dir) return;
      try {
        const granted = dir.queryPermission ? (await dir.queryPermission({ mode: 'readwrite' })) === 'granted' : true;
        if (!granted) {
          setSyncStatus('blocked');
          return;
        }
        const subdir = await dir.getDirectoryHandle('trades_data', { create: true });
        setDataDir(subdir);
        setSyncStatus('on');
      } catch (err) {
        console.warn('trading-journal: reconnecting folder sync failed', err);
        setSyncStatus('blocked');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [syncSupported]);

  const handleConnectSync = useCallback(async () => {
    setSyncStatus('connecting');
    const result = await connectJournalDirectory();
    if (result.ok) {
      setDataDir(result.dataDir);
      setSyncStatus('on');
      setToast({ message: 'Folder sync connected — writing to trades_data/ on every save.', tone: 'pos' });
      return;
    }
    if (result.reason === 'canceled') {
      setSyncStatus(dataDir ? 'on' : 'off');
      return;
    }
    if (result.reason === 'unsupported') {
      setSyncStatus('unsupported');
      setToast({ message: 'This browser cannot sync to a folder. Use Chrome or Edge.', tone: 'neg' });
      return;
    }
    setSyncStatus('blocked');
    setToast({ message: 'Folder access was not granted. Your trades stay in the browser.', tone: 'neg' });
  }, [dataDir]);

  const handleDisconnectSync = useCallback(async () => {
    setDataDir(null);
    setSyncStatus('off');
    setSyncAuto(true);
    await forgetDirectoryHandle();
    setToast({ message: 'Folder sync disconnected. Copies already written stay on disk.', tone: 'pos' });
  }, []);

  /** Write the current snapshot to trades_data/. Returns a timestamp or null. */
  const syncNow = useCallback(
    async (currentTrades) => {
      if (!dataDir) return null;
      const granted = await verifyPermission(dataDir);
      if (!granted) {
        setSyncStatus('blocked');
        return null;
      }
      const snapshot = {
        trades: currentTrades,
        rules: loadRules(),
        capitals,
      };
      const result = await writeJournalFolder(dataDir, snapshot);
      if (!result.ok) {
        setSyncStatus('error');
        return null;
      }
      setSyncStatus('on');
      return new Date();
    },
    [dataDir, capitals],
  );

  const syncNowUser = useCallback(async () => {
    const timestamp = await syncNow(trades ?? []);
    setSyncNote({
      tone: timestamp ? 'pos' : 'neg',
      message: timestamp ? `Saved to trades_data/ at ${timestamp.toLocaleTimeString()}` : 'Could not write to trades_data/.',
    });
  }, [syncNow, trades]);

  // Debounced auto-sync whenever journal data (trades/capitals) changes.
  useEffect(() => {
    if (!dataDir || !syncAuto) return undefined;
    const timer = window.setTimeout(() => {
      syncNow(trades ?? []).catch(() => {});
    }, SYNC_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trades, capitals, syncAuto, dataDir, syncNow]);

  const openNewTrade = useCallback(() => setForm({ mode: 'new' }), []);
  const openEditTrade = useCallback(
    (trade) => {
      // Recorded history lock: closed trades are enforced as immutable at
      // the data layer too, but some flows may still hold a stale trade
      // object, so the form entry point refuses them explicitly.
      if (trade && !isTradeOpen(trade)) {
        setToast({
          message: 'Closed trades are locked from editing. Delete and re-enter the trade to correct its history.',
          tone: 'neg',
        });
        return;
      }
      setForm({ mode: 'edit', trade });
    },
    [],
  );
  const closeForm = useCallback(() => setForm(null), []);

  /** Save the trade record, then mirror any screenshot change to IndexedDB. */
  const saveTradeWithScreenshot = useCallback(
    async (values) => {
      const isEdit = form?.mode === 'edit';
      // New trades adopt the currency of the market you're viewing when you
      // log them (India → INR, US → USD). Edited trades keep their native
      // currency — unless you fixed the market field itself (e.g. entered
      // under the wrong market), in which case the trade is re-tagged to
      // the market you're viewing while you fix it.
      const marketChanged = isEdit && form.trade.market !== values.market;
      const base = marketChanged
        ? updateTrade(form.trade.id, { ...values, currency })
        : isEdit
          ? updateTrade(form.trade.id, values)
          : addTrade({ ...values, currency });
      if (!base?.ok) return base;

      const tradeId = isEdit ? form.trade.id : base.tradeId;
      const file = values.screenshotFile instanceof File ? values.screenshotFile : null;
      const removeExisting = values.screenshotRemoveExisting === true;

      try {
        if (file) {
          const stored = await putScreenshot(tradeId, file);
          if (!stored) {
            return {
              ok: true,
              screenshotWarning:
                'Trade saved, but the screenshot could not be stored in this browser (private browsing?).',
            };
          }
          if (!isEdit || form.trade.hasScreenshot !== true) {
            updateTrade(tradeId, { hasScreenshot: true });
          }
        } else if (removeExisting && isEdit) {
          await deleteScreenshot(tradeId);
          updateTrade(tradeId, { hasScreenshot: false });
        }
      } catch (err) {
        console.warn('trading-journal: screenshot save failed', err);
        return { ok: true, screenshotWarning: 'Trade saved, but the screenshot failed to store.' };
      }
      return base;
    },
    [form, addTrade, updateTrade, currency],
  );

  const handleFormSave = useCallback(
    async (values) => {
      const result = await saveTradeWithScreenshot(values);
      if (result?.ok) {
        setToast({
          message: result.screenshotWarning || (form?.mode === 'edit' ? 'Trade updated.' : 'Trade added.'),
          tone: result.screenshotWarning ? 'neg' : 'pos',
        });
        setForm(null);
      }
      return result;
    },
    [saveTradeWithScreenshot, form],
  );

  const handleViewScreenshot = useCallback(async (trade) => {
    const blob = await getScreenshot(trade.id);
    if (blob instanceof Blob) {
      setScreenshotView({ trade, url: URL.createObjectURL(blob) });
    } else {
      setToast({
        message: 'No screenshot found on this device for this trade (attachments are local-only).',
        tone: 'neg',
      });
    }
  }, []);

  /** Delete a trade everywhere it lives: record, and its screenshot blob. */
  const handleDeleteTrade = useCallback(
    async (tradeId) => {
      try {
        await deleteScreenshot(tradeId);
      } catch (err) {
        // The record itself must still go; a leftover blob is harmless.
        console.warn('trading-journal: screenshot cleanup failed', err);
      }
      return deleteTrade(tradeId);
    },
    [deleteTrade],
  );

  const closeScreenshotView = useCallback(() => {
    setScreenshotView((current) => {
      if (current?.url) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  const navigate = useCallback((nextView) => {
    if (VIEWS.includes(nextView)) setView(nextView);
  }, []);

  const changeCurrency = useCallback((next) => {
    if (saveCurrency(next)) setCurrency(next);
  }, []);

  /** Live crypto price feed toggle (Settings). */
  const changeLivePrices = useCallback((next) => {
    if (saveLivePrices(next === true)) {
      setLivePrices(next === true);
      setToast({
        message: next === true ? 'Live crypto prices on (Binance public API).' : 'Live crypto prices off.',
        tone: 'pos',
      });
    }
  }, []);

  const handleSaveCapitals = useCallback(
    (map) => {
      const saved = saveCapitals(map);
      if (saved) {
        setCapitals(loadCapitals());
        const parts = [];
        if (typeof map?.INR === 'number') parts.push(`India ₹${Number(map.INR).toLocaleString('en-IN')}`);
        if (typeof map?.USD === 'number') parts.push(`US $${Number(map.USD).toLocaleString('en-US')}`);
        setToast({
          message: parts.length ? `Capital updated: ${parts.join(' · ')}` : 'Capital entries cleared.',
          tone: 'pos',
        });
      }
      return saved;
    },
    [],
  );

  const handleRestoreFromFolder = useCallback(async () => {
    if (!dataDir) return;
    const granted = await verifyPermission(dataDir);
    if (!granted) {
      setSyncStatus('blocked');
      setToast({ message: 'Folder access needs re-verification before restoring.', tone: 'neg' });
      return;
    }
    const parsed = await readJournalTrades(dataDir);
    if (!parsed) {
      setToast({ message: 'trades_data/trades.json could not be read in that folder.', tone: 'neg' });
      return;
    }
    setConfirmRestore(parsed);
  }, [dataDir]);

  const doRestore = useCallback(
    (list) => {
      const count = restoreTrades(list);
      setConfirmRestore(null);
      setToast({ message: `Restored ${count} trades from trades_data/.`, tone: 'pos' });
    },
    [restoreTrades],
  );

  const handleDeleteAll = useCallback(() => {
    clearAll();
    setConfirmDeleteAll(false);
    setToast({ message: 'All trades deleted.', tone: 'neg' });
  }, [clearAll]);

  const currencyValue = useMemo(() => ({ currency, setCurrency: changeCurrency }), [currency, changeCurrency]);

  return (
    <CurrencyContext.Provider value={currencyValue}>
      <div className="layout">
        <Sidebar
          view={view}
          onNavigate={navigate}
          total={stats.total}
          openCount={stats.open}
          currency={currency}
          onCurrencyChange={changeCurrency}
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
              capital={marketCapital}
              livePrices={live}
              onAddTrade={openNewTrade}
              onEditTrade={openEditTrade}
              onDeleteTrade={handleDeleteTrade}
              onViewTrades={() => navigate('trades')}
              onOpenCalculator={() => navigate('calculator')}
            />
          )}

          {view === 'trades' && (
            <TradesPage
              trades={trades ?? []}
              livePrices={live}
              onAdd={openNewTrade}
              onEdit={openEditTrade}
              onDelete={handleDeleteTrade}
              onViewScreenshot={handleViewScreenshot}
            />
          )}

          {view === 'news' && <NewsPage />}
          {view === 'rules' && <RulesPage />}

          {view === 'calculator' && <CalculatorPage capital={marketCapital} />}

          {view === 'settings' && (
            <SettingsPage
              stats={stats}
              trades={trades ?? []}
              importTrades={importTrades}
              restoreTrades={restoreTrades}
              clearAll={() => setConfirmDeleteAll(true)}
              capitals={capitals}
              onSaveCapitals={handleSaveCapitals}
              syncSupported={syncSupported}
              syncStatus={syncStatus}
              syncAuto={syncAuto}
              onSyncAutoChange={setSyncAuto}
              dataDir={dataDir}
              syncNote={syncNote}
              onConnectSync={handleConnectSync}
              onDisconnectSync={handleDisconnectSync}
              onSyncNow={syncNowUser}
              onRestoreFromFolder={handleRestoreFromFolder}
              livePrices={livePrices}
              onLivePricesChange={changeLivePrices}
            />
          )}
        </main>

        {form ? (
          <Modal title={form.mode === 'new' ? 'Add trade' : 'Edit trade'} onClose={closeForm} width={520}>
            <TradeForm
              initial={form.mode === 'edit' ? form.trade : null}
              onSave={handleFormSave}
              onCancel={closeForm}
            />
          </Modal>
        ) : null}

        {screenshotView ? (
          <Modal title={`Screenshot — ${screenshotView.trade.symbol}`} onClose={closeScreenshotView} width={760}>
            <img
              className="screenshot-full"
              src={screenshotView.url}
              alt={`Screenshot for the ${screenshotView.trade.symbol} trade`}
            />
            <div className="modal-actions">
              <a className="btn btn-ghost" href={screenshotView.url} download={`screenshot-${screenshotView.trade.id}.png`}>
                Download
              </a>
              <button type="button" className="btn btn-ghost" onClick={closeScreenshotView}>
                Close
              </button>
            </div>
          </Modal>
        ) : null}

        {confirmDeleteAll ? (
          <ConfirmDialog
            title="Delete all trades?"
            body="This permanently removes every trade from this device (and rewrites trades.json on the next sync)."
            confirmLabel="Delete all trades"
            danger
            onCancel={() => setConfirmDeleteAll(false)}
            onConfirm={handleDeleteAll}
          />
        ) : null}

        {confirmRestore ? (
          <ConfirmDialog
            title="Restore from trades_data?"
            body={`This replaces your ${stats.total} current trades with the ${confirmRestore.length} records in trades_data/trades.json. Screenshots are not included.`}
            confirmLabel="Restore trades"
            danger
            onCancel={() => setConfirmRestore(null)}
            onConfirm={() => doRestore(confirmRestore)}
          />
        ) : null}

        {toast ? (
          <div className={`toast toast-${toast.tone}`} role="status">
            {toast.message}
          </div>
        ) : null}
      </div>
    </CurrencyContext.Provider>
  );
}

export default App;
