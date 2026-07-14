import styles from './RenderStyleSelector.module.scss';
import {
  getRenderStylesList,
  DEFAULT_RENDER_STYLE_ID
} from '@shared/constants/renderStyles.js';

/**
 * RenderStyleSelector - Grid of pre-made render style chips
 *
 * Each chip shows a gradient swatch + emoji as a lightweight visual
 * thumbnail, with the style name underneath and the description on hover.
 * Works in both the 3DStreet Editor (Screenshot & Render modal) and the
 * Image Generator.
 */
const RenderStyleSelector = ({
  value = DEFAULT_RENDER_STYLE_ID,
  onChange,
  disabled = false
}) => {
  const styleList = getRenderStylesList();

  return (
    <div
      className={styles.grid}
      role="radiogroup"
      aria-label="Render style presets"
    >
      {styleList.map((style) => {
        const isSelected = style.id === value;
        return (
          <button
            key={style.id}
            type="button"
            role="radio"
            aria-checked={isSelected}
            title={style.description}
            disabled={disabled}
            className={`${styles.chip} ${isSelected ? styles.selected : ''}`}
            onClick={() => onChange && onChange(style.id)}
          >
            <span
              className={styles.swatch}
              style={{ background: style.swatch }}
            >
              <span className={styles.emoji} aria-hidden="true">
                {style.emoji}
              </span>
            </span>
            <span className={styles.name}>{style.name}</span>
          </button>
        );
      })}
    </div>
  );
};

export default RenderStyleSelector;
