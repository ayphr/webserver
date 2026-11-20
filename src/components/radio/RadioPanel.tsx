import { IconPlayerPause, IconPlayerPlay, IconVolume, IconVolume2 } from '@tabler/icons-react';
import { Slider } from '../common';
import { useRadio } from '../../context';
import { RADIO_STYLES, type RadioStyle } from '../../lib/radio/GentleLofiEngine';
import './RadioPanel.css';

const STYLE_LABELS: Record<RadioStyle, string> = {
  gentle: 'Gentle',
  jazzy: 'Jazzy',
  rainy: 'Rainy',
};

export const RadioPanel = () => {
  const { isPlaying, volume, style, toggle, setVolume, setStyle } = useRadio();

  return (
    <div className="radio">
      <button
        type="button"
        className={`radio__play ${isPlaying ? 'radio__play--active' : ''}`}
        onClick={() => { void toggle(); }}
        aria-label={isPlaying ? 'Pause radio' : 'Play radio'}
        aria-pressed={isPlaying}
      >
        {isPlaying
          ? <IconPlayerPause size={32} strokeWidth={1.75} />
          : <IconPlayerPlay size={32} strokeWidth={1.75} />}
      </button>

      <div className="radio__styles" role="group" aria-label="Lofi style">
        {RADIO_STYLES.map((option) => (
          <button
            key={option}
            type="button"
            className={`radio__style ${style === option ? 'radio__style--active' : ''}`}
            aria-pressed={style === option}
            onClick={() => setStyle(option)}
          >
            {STYLE_LABELS[option]}
          </button>
        ))}
      </div>

      <div className="radio__volume">
        <Slider
          value={volume}
          onChange={setVolume}
          ariaLabel="Radio volume"
          valueLabel={`${Math.round(volume * 100)}%`}
          leadingIcon={volume === 0 ? <IconVolume size={18} /> : <IconVolume2 size={18} />}
        />
      </div>
    </div>
  );
};

export default RadioPanel;
