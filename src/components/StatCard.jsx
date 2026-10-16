/**
 * Small stat card for the dashboard summary row.
 *
 * Props:
 *   label  string — small muted caption above the value
 *   value  node  — the headline number (rendered large, monospace)
 *   sub    node? — optional secondary line beneath the value
 *   tone   'neutral' | 'pos' | 'neg' — green/red/neutral value accent
 */
export default function StatCard({ label, value, sub, tone = 'neutral' }) {
  const toneClass =
    tone === 'pos' ? 'stat-card--pos' : tone === 'neg' ? 'stat-card--neg' : '';

  return (
    <div className={`card stat-card${toneClass ? ` ${toneClass}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub != null && sub !== '' && <span className="stat-sub">{sub}</span>}
    </div>
  );
}
