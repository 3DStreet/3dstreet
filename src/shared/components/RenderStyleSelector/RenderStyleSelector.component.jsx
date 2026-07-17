import * as Tooltip from '@radix-ui/react-tooltip';
import styles from './RenderStyleSelector.module.scss';
import {
  getRenderStylesList,
  NONE_STYLE
} from '@shared/constants/renderStyles.js';

/**
 * RenderStyleSelector - Single row of style chips that fill the style field
 *
 * Each chip is just its gradient swatch + emoji so the whole set fits on
 * one row; the name and description show in an instant tooltip on hover.
 * Clicking a chip hands the caller its style ID so the caller can write the
 * matching style sentence (getStyleSentence) into the style text field; the
 * trailing 'none' chip clears it. `activeStyleId` highlights the chip whose
 * unedited sentence is in the field — derive it with describeStyleText
 * ('none' lights the none chip, 'custom' matches nothing).
 *
 * Works in both the 3DStreet Editor (Screenshot & Render modal) and the
 * Image Generator. `labels` optionally overrides the English name and
 * description per style ID for localization.
 */
const RenderStyleSelector = ({
  activeStyleId = null,
  onSelect,
  disabled = false,
  labels = {}
}) => {
  const styleList = [...getRenderStylesList(), NONE_STYLE];

  return (
    <Tooltip.Provider delayDuration={0} skipDelayDuration={300}>
      <div className={styles.row}>
        {styleList.map((style) => {
          const isActive = style.id === activeStyleId;
          const label = labels[style.id] || {};
          return (
            <Tooltip.Root key={style.id}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  aria-pressed={isActive}
                  aria-label={label.name || style.name}
                  disabled={disabled}
                  className={`${styles.chip} ${isActive ? styles.selected : ''}`}
                  onClick={() => onSelect && onSelect(style.id)}
                >
                  <span
                    className={styles.swatch}
                    style={{ background: style.swatch }}
                  >
                    <span className={styles.emoji} aria-hidden="true">
                      {style.emoji}
                    </span>
                  </span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  className={styles.tooltip}
                  sideOffset={6}
                  collisionPadding={8}
                >
                  <span className={styles.tooltipName}>
                    {label.name || style.name}
                  </span>
                  <span className={styles.tooltipDescription}>
                    {label.description || style.description}
                  </span>
                  <Tooltip.Arrow className={styles.tooltipArrow} />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          );
        })}
      </div>
    </Tooltip.Provider>
  );
};

export default RenderStyleSelector;
