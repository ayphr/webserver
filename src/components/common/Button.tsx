import { Link } from 'react-router-dom';
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  fullWidth?: boolean;
  isLoading?: boolean;
  to?: string;
  href?: string;
  target?: string;
  rel?: string;
}

export const Button = ({
  variant = 'primary',
  fullWidth = false,
  isLoading = false,
  disabled,
  children,
  className = '',
  to,
  href,
  target,
  rel,
  ...props
}: ButtonProps) => {
  const content = isLoading ? (
    <>
      <span className="button__loader" aria-hidden="true">
        <span className="button__loader-spinner" />
      </span>
      <span className="sr-only">{children}</span>
    </>
  ) : (
    children
  );

  const combinedClassName = `button button--${variant} ${fullWidth ? 'button--full-width' : ''} ${className}`;

  // `props` are button attributes; strip the ones that are meaningless on links.
  const linkProps: Record<string, unknown> = { ...props };
  for (const key of ['type', 'form', 'formAction', 'formMethod', 'formNoValidate', 'formTarget']) {
    delete linkProps[key];
  }
  const anchorProps = linkProps as AnchorHTMLAttributes<HTMLAnchorElement>;

  if (href && !disabled && !isLoading) {
    return (
      <a
        {...anchorProps}
        href={href}
        className={combinedClassName}
        target={target}
        rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
        aria-busy={isLoading || undefined}
      >
        {content}
      </a>
    );
  }

  if (to && !disabled && !isLoading) {
    return (
      <Link
        {...anchorProps}
        to={to}
        className={combinedClassName}
        aria-busy={isLoading || undefined}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type={props.type ?? 'button'}
      className={combinedClassName}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...props}
    >
      {content}
    </button>
  );
};
