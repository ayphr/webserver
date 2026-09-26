import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface ModalState {
  isOpen: boolean;
  title?: string;
  content?: ReactNode;
  onConfirm?: () => void;
  onCancel?: () => void;
  showCancel?: boolean;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
}

export interface ModalContextType {
  modal: ModalState;
  openModal: (options: Omit<ModalState, 'isOpen'>) => void;
  closeModal: () => void;
}

export const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within ModalProvider');
  }
  return context;
};
