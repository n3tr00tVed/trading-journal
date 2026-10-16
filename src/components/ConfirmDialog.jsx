import Modal from './Modal.jsx';

/** Confirmation dialog for destructive actions. */
export default function ConfirmDialog({ title, body, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <p className="confirm-body">{body}</p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          onClick={onConfirm}
          autoFocus
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
