import './Modal.css';
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
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

const isVisible = (element: HTMLElement) => element.offsetParent !== null || element === document.activeElement;

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
  const formRef = useRef<HTMLFormElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    scrollLockCount += 1;
    document.body.style.overflow = 'hidden';

    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const body = dialog?.querySelector<HTMLElement>('.modal__body');
      const footer = dialog?.querySelector<HTMLElement>('.modal__footer');
      const target = body?.querySelector<HTMLElement>(FOCUSABLE)
        ?? footer?.querySelector<HTMLElement>(FOCUSABLE)
        ?? dialog?.querySelector<HTMLElement>('[data-modal-confirm]')
        ?? dialog?.querySelector<HTMLElement>('.modal__close')
        ?? dialog;
      target?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) document.body.style.overflow = '';
      setConfirmError(null);
      setIsConfirming(false);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const requestClose = () => {
    if (isConfirming) return;
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) requestClose();
  };

  const handleConfirm = async () => {
    if (!onConfirm || isConfirming || confirmDisabled) return;
    setIsConfirming(true);
    setConfirmError(null);
    try {
      const result = await onConfirm();
      if (result !== false) {
        setConfirmError(null);
        onClose();
      }
    } catch (error) {
      setConfirmError(error instanceof Error && error.message
        ? error.message
        : 'Could not complete the action. Please try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handleConfirm();
  };

  const handleFormKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    const target = event.target as HTMLElement;
    // Let buttons/links handle their own Enter activation; textarea keeps newlines.
    if (['BUTTON', 'A', 'TEXTAREA'].includes(target.tagName)) return;
    event.preventDefault();
    formRef.current?.requestSubmit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
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
        aria-describedby={children ? bodyId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {title && (
          <div className="modal__header">
            <h2 className="modal__title" id={titleId}>{title}</h2>
            <button className="modal__close" onClick={requestClose} aria-label="Close modal">
              <IconX size={20} aria-hidden="true" />
            </button>
          </div>
        )}
        <form ref={formRef} className="modal__form" onSubmit={handleSubmit} onKeyDown={handleFormKeyDown}>
          {children && <div className="modal__body" id={bodyId}>{children}</div>}
          {confirmError && (
            <p className="modal__error" role="alert">{confirmError}</p>
          )}
          {(showCancel || onConfirm) && (
            <div className="modal__footer">
              {showCancel && (
                <Button variant="secondary" onClick={requestClose} disabled={isConfirming}>
                  {cancelText}
                </Button>
              )}
              {onConfirm && (
                <Button
                  type="submit"
                  data-modal-confirm
                  variant={isDangerous ? 'danger' : 'primary'}
                  disabled={confirmDisabled || isConfirming}
                  isLoading={isConfirming}
                >
                  {confirmText}
                </Button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
