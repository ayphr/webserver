import { Link } from 'react-router-dom';
import './Button.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
    <span className="button__loader">
      <span className="button__loader-spinner" />
    </span>
  ) : (
    children
  );

  const combinedClassName = `button button--${variant} ${fullWidth ? 'button--full-width' : ''} ${className}`;

  if (href && !disabled && !isLoading) {
    return (
      <a
        href={href}
        className={combinedClassName}
        target={target}
        rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
      >
        {content}
      </a>
    );
  }

  if (to && !disabled && !isLoading) {
    return (
      <Link to={to} className={combinedClassName}>
        {content}
      </Link>
    );
  }

  return (
    <button
      className={combinedClassName}
      disabled={disabled || isLoading}
      {...props}
    >
      {content}
    </button>
  );
};
