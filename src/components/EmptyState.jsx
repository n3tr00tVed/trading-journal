/**
 * Centered muted panel for empty datasets.
 *
 * Props:
 *   title   string
 *   body    string
 *   action  { label: string, onClick: fn } — renders one primary button
 */
export default function EmptyState({ title, body, action }) {
  return (
    <div className="card empty">
      <h2 className="empty-title">{title}</h2>
      {body && <p className="empty-body">{body}</p>}
      {action?.label && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
