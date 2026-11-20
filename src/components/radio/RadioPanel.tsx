import { IconPlayerPause, IconPlayerPlay, IconVolume, IconVolume2 } from '@tabler/icons-react';
import { Slider } from '../common';
import { useRadio } from '../../context';
import './RadioPanel.css';

export const RadioPanel = () => {
  const { isPlaying, volume, toggle, setVolume } = useRadio();

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
