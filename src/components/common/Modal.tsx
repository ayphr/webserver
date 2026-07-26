import './Modal.css';
import { type ReactNode, useEffect } from 'react';
import { Button } from './Button';
import { IconX } from '@tabler/icons-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title?: string;
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  showCancel?: boolean;
  isDangerous?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

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
  size = 'md',
}: ModalProps) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleConfirm = () => {
    onConfirm?.();
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className={`modal modal--${size}`}>
        {title && (
          <div className="modal__header">
            <h2 className="modal__title">{title}</h2>
            <button className="modal__close" onClick={onClose} aria-label="Close modal">
              <IconX size={20} />
            </button>
          </div>
        )}
        {children && <div className="modal__body">{children}</div>}
        {(showCancel || onConfirm) && (
          <div className="modal__footer">
            {showCancel && (
              <Button variant="secondary" onClick={onClose}>
                {cancelText}
              </Button>
            )}
            {onConfirm && (
              <Button
                variant={isDangerous ? 'danger' : 'primary'}
                onClick={handleConfirm}
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
