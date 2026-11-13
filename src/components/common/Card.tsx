import './Card.css';
import type React from 'react';
import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  elevated?: boolean;
  role?: string;
  tabIndex?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}

export const Card = ({ children, className = '', onClick, elevated = false, role, tabIndex, onKeyDown }: CardProps) => {
  return (
    <div
      className={`card ${elevated ? 'card--elevated' : ''} ${className}`}
      onClick={onClick}
      role={role}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
};

export interface CardHeaderProps {
  children: ReactNode;
  className?: string;
}

export const CardHeader = ({ children, className = '' }: CardHeaderProps) => {
  return <div className={`card__header ${className}`}>{children}</div>;
};

export interface CardBodyProps {
  children: ReactNode;
  className?: string;
}

export const CardBody = ({ children, className = '' }: CardBodyProps) => {
  return <div className={`card__body ${className}`}>{children}</div>;
};

export interface CardFooterProps {
  children: ReactNode;
  className?: string;
}

export const CardFooter = ({ children, className = '' }: CardFooterProps) => {
  return <div className={`card__footer ${className}`}>{children}</div>;
};
