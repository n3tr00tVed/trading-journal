import { useEffect, useRef } from 'react';

/**
 * Accessible modal dialog. Focus is moved into it on open, Escape and
 * backdrop clicks close it, and page scroll is locked while visible.
 */
export default function Modal({ title, onClose, children, width = 560 }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    const focusables = node?.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
    );
    (focusables?.[0] ?? node)?.focus();

    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        style={{ maxWidth: width }}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn btn-ghost modal-close" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
