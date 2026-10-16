/**
 * Vertical sidebar navigation for the app shell.
 *
 * Props:
 *   view        'dashboard' | 'trades' | 'rules' | 'settings' — active view key
 *   onNavigate  (view) => void — receives the requested view id
 *   total       number — total trades (shown as a badge on "Trades")
 *   openCount   number — open trades (shown alongside the total badge)
 */
const VIEWS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'trades', label: 'Trades' },
  { id: 'news', label: 'News' },
  { id: 'rules', label: 'Rules' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'settings', label: 'Settings' },
];

function badgeText(total, openCount) {
  const totalPart = Number.isFinite(total) ? String(total) : '0';
  if (Number.isFinite(openCount) && openCount > 0) {
    return `${totalPart} · ${openCount} open`;
  }
  return totalPart;
}

export default function Sidebar({
  view,
  onNavigate,
  total = 0,
  openCount = 0,
  currency = 'INR',
  onCurrencyChange = () => {},
}) {
  return (
    <nav className="sidebar" aria-label="Primary navigation">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="app-title">Trading Journal</span>
      </div>
      <ul className="nav">
        {VIEWS.map(({ id, label }) => {
          const badge =
            id === 'trades' ? badgeText(total, openCount) : null;
          const isActive = view === id;
          return (
            <li key={id}>
              <button
                type="button"
                className={`nav-btn${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                aria-label={
                  id === 'trades'
                    ? `Trades, ${badgeText(total, openCount)}`
                    : label
                }
                onClick={() => onNavigate(id)}
              >
                <span className="nav-label">{label}</span>
                {badge && <span className="nav-badge">{badge}</span>}
              </button>
              <span className="visually-hidden">
                {isActive ? ' (current page)' : ''}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="market-switch">
        <label className="market-label" htmlFor="market-switch">
          Trading market
        </label>
        <select
          id="market-switch"
          className="market-select"
          value={currency}
          onChange={(event) => onCurrencyChange(event.target.value)}
        >
          <option value="INR">🇮🇳 India · ₹ INR</option>
          <option value="USD">🇺🇸 US · $ USD</option>
        </select>
      </div>
      <p className="sidebar-foot">Local-only · your trades never leave this browser.</p>
    </nav>
  );
}
