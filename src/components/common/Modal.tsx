import './Modal.css';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Button } from './Button';
import { IconX } from '@tabler/icons-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Return `false` (or resolve to `false`) to keep the dialog open. */
  onConfirm?: () => void | boolean | Promise<void | boolean>;
  title?: string;
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  isDangerous?: boolean;
  confirmDisabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

let scrollLockCount = 0;

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export const Modal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  children,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  showCancel = true,
  isDangerous = false,
  confirmDisabled = false,
  size = 'md',
}: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    scrollLockCount += 1;
    document.body.style.overflow = 'hidden';

    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const target = dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog;
      target?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) document.body.style.overflow = '';
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleConfirm = async () => {
    if (!onConfirm || isConfirming) return;
    setIsConfirming(true);
    try {
      const result = await onConfirm();
      if (result !== false) onClose();
    } catch {
      // Keep the dialog open so the caller can show an error to the user.
    } finally {
      setIsConfirming(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick} role="presentation">
      <div
        ref={dialogRef}
        className={`modal modal--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {title && (
          <div className="modal__header">
            <h2 className="modal__title" id={titleId}>{title}</h2>
            <button className="modal__close" onClick={onClose} aria-label="Close modal">
              <IconX size={20} aria-hidden="true" />
            </button>
          </div>
        )}
        {children && <div className="modal__body">{children}</div>}
        {(showCancel || onConfirm) && (
          <div className="modal__footer">
            {showCancel && (
              <Button variant="secondary" onClick={onClose} disabled={isConfirming}>
                {cancelText}
              </Button>
            )}
            {onConfirm && (
              <Button
                variant={isDangerous ? 'danger' : 'primary'}
                disabled={confirmDisabled || isConfirming}
                isLoading={isConfirming}
                onClick={() => { void handleConfirm(); }}
              >
                {confirmText}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
