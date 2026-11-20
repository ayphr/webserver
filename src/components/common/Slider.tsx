import type { CSSProperties, ReactNode } from 'react';
import './Slider.css';

export type SliderProps = {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
  leadingIcon?: ReactNode;
  valueLabel?: string;
};

export const Slider = ({
  value,
  onChange,
  ariaLabel,
  min = 0,
  max = 1,
  step = 0.01,
  leadingIcon,
  valueLabel,
}: SliderProps) => {
  const clamped = Math.min(max, Math.max(min, value));
  const progress = max === min ? 0 : ((clamped - min) / (max - min)) * 100;
  const style = { '--slider-progress': `${progress}%` } as CSSProperties;

  return (
    <div className="slider" style={style}>
      {valueLabel && (
        <div className="slider__header">
          <span className="slider__value">{valueLabel}</span>
        </div>
      )}
      <div className="slider__row">
        {leadingIcon && <span className="slider__icon" aria-hidden="true">{leadingIcon}</span>}
        <input
          className="slider__input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={clamped}
          aria-label={ariaLabel}
          aria-valuetext={valueLabel}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </div>
    </div>
  );
};
