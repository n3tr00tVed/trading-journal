import { useEffect, useMemo, useRef, useState } from 'react';
import { loadRules, saveRules } from '../lib/rulesStorage.js';
import ConfirmDialog from './ConfirmDialog.jsx';

const AUTOSAVE_DELAY_MS = 600;

/**
 * Rules page: the user's personal trading rules, free-form text,
 * automatically saved to this device as they type (debounced).
 */
export default function RulesPage() {
  const [text, setText] = useState(() => loadRules());
  const [status, setStatus] = useState(text ? 'Saved' : 'No rules yet'); // Saved | Unsaved changes | Saving
  const [confirmClear, setConfirmClear] = useState(false);
  const pendingRef = useRef({ timer: null, value: null });

  const flush = useMemo(
    () =>
      (value) => {
        const ok = saveRules(value);
        setStatus(ok ? 'Saved' : 'Could not save (storage unavailable)');
      },
    [],
  );

  const scheduleSave = (value) => {
    setStatus('Unsaved changes');
    if (pendingRef.current.timer) window.clearTimeout(pendingRef.current.timer);
    pendingRef.current.timer = window.setTimeout(() => {
      pendingRef.current.timer = null;
      flush(value);
    }, AUTOSAVE_DELAY_MS);
  };

  // Flush any pending edit before the page unmounts or closes.
  useEffect(
    () => () => {
      if (pendingRef.current.timer) {
        window.clearTimeout(pendingRef.current.timer);
        if (pendingRef.current.value !== null) flush(pendingRef.current.value);
      }
    },
    [flush],
  );

  const handleChange = (event) => {
    const value = event.target.value;
    pendingRef.current.value = value;
    setText(value);
    scheduleSave(value);
  };

  const handleClear = () => {
    if (pendingRef.current.timer) {
      window.clearTimeout(pendingRef.current.timer);
      pendingRef.current.timer = null;
    }
    flush('');
    setText('');
    setConfirmClear(false);
  };

  const lineCount = text === '' ? 0 : text.split('\n').length;

  return (
    <section className="page-shell" aria-labelledby="rules-heading">
      <header className="page-head">
        <div>
          <h1 id="rules-heading" className="page-title">Rules</h1>
          <p className="page-sub">Your personal trading rules — the plan you follow before you click buy or sell. Saved automatically on this device.</p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(true)} disabled={text === ''}>
          Clear rules
        </button>
      </header>

      <div className="card rules-card">
        <div className="rules-meta">
          <label htmlFor="rules-text" className="label">
            Trading rules
          </label>
          <span className="rules-status" role="status" aria-live="polite">
            {status}
            {status === 'Saved' && text !== '' ? ' ✓' : ''}
          </span>
        </div>
        <textarea
          id="rules-text"
          className="field rules-textarea"
          value={text}
          onChange={handleChange}
          placeholder={'Write your rules, e.g.\n\n1. Risk max 1% of account per trade.\n2. No entries in the first 15 minutes after open.\n3. Always set a stop before entering.\n4. Journal every trade the same evening.'}
          rows={18}
          spellCheck="true"
          aria-describedby="rules-meta-info"
        />
        <p id="rules-meta-info" className="page-sub">
          {lineCount} {lineCount === 1 ? 'line' : 'lines'} · Private to this browser profile.
        </p>
      </div>

      {confirmClear ? (
        <ConfirmDialog
          title="Clear your rules?"
          body="This permanently deletes your rules text. Export or copy it first if you want to keep a copy."
          confirmLabel="Delete rules"
          danger
          onCancel={() => setConfirmClear(false)}
          onConfirm={handleClear}
        />
      ) : null}
    </section>
  );
}
