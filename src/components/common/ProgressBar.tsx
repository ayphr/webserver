import './ProgressBar.css';

export type ProgressBarProps = {
  value: number;
  max?: number;
  label?: string;
  className?: string;
  color?: string;
};

export function ProgressBar({ value, max = 100, label, className, color }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={`progress-bar ${className ?? ''}`.trim()}>
      <div
        className="progress-bar__fill"
        style={{ width: `${pct}%`, background: color }}
      />
      {label && <span className="progress-bar__label">{label}</span>}
    </div>
  );
}