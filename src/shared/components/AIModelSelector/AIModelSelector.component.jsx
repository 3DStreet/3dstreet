import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import styles from './AIModelSelector.module.scss';
import {
  REPLICATE_MODELS,
  MODEL_GROUPS,
  getGroupedModels,
  VIDEO_MODELS,
  VIDEO_MODEL_GROUPS,
  getGroupedVideoModels
} from '@shared/constants/replicateModels.js';
import { TokenDisplayBase } from '@shared/auth/components';

// Simple inline icon renderer
const AwesomeIconSimple = ({ icon, size = 12, className = '' }) => {
  const width = icon.icon[0];
  const height = icon.icon[1];
  const vectorData = icon.icon[4];

  return (
    <svg
      role="img"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={size}
      style={{ display: 'inline-block' }}
    >
      <path fill="currentColor" d={vectorData} />
    </svg>
  );
};

// Format a per-second rate without trailing zeros: 4, 1.4, 0.5.
const formatRate = (n) => String(Math.round(n * 10) / 10);

// The token cost shown in a model's badge, or null for none. Video models
// are billed per second, so they show a per-second rate rather than a flat
// per-generation cost. `tokenCostLabel` overrides (e.g. a tier range).
const getCostLabel = (model, mode) => {
  if (!model) return null;
  if (model.tokenCostLabel) return model.tokenCostLabel;
  if (mode === 'video') {
    // tokenCost5s bills the short tier: 5s, or `shortDuration` (Veo: 4s)
    const seconds = model.shortDuration || 5;
    return model.tokenCost5s
      ? `${formatRate(model.tokenCost5s / seconds)}/s`
      : null;
  }
  return model.tokenCost >= 1 ? model.tokenCost : null;
};

const CostBadge = ({ model, mode }) => {
  const label = getCostLabel(model, mode);
  if (label === null) return null;
  return (
    <TokenDisplayBase
      count={label}
      inline={true}
      compact={true}
      className={styles.tokenCostBadge}
    />
  );
};

const AIModelSelector = ({
  value,
  onChange,
  disabled = false,
  mode = 'image', // 'image' or 'video'
  hasSourceImage = true, // When false, filter out models that require source images (e.g., fal.ai edit models)
  // Optional flat model list ({ id, name, logo?, tokenCost?, tokenCostLabel? })
  // that replaces the built-in image/video catalogs — used by the generator's
  // splat and 3D model tabs, whose catalogs live with their tabs.
  options = null
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Select appropriate models and groups based on mode (or custom options)
  let models, modelGroups, rawGroupedModels;
  if (options) {
    models = Object.fromEntries(options.map((m) => [m.id, m]));
    modelGroups = { all: { order: 0 } };
    rawGroupedModels = { all: options };
  } else {
    models = mode === 'video' ? VIDEO_MODELS : REPLICATE_MODELS;
    modelGroups = mode === 'video' ? VIDEO_MODEL_GROUPS : MODEL_GROUPS;
    rawGroupedModels =
      mode === 'video' ? getGroupedVideoModels() : getGroupedModels();
  }

  // Filter out models that require source images if hasSourceImage is false
  const groupedModels = {};
  Object.entries(rawGroupedModels).forEach(([groupKey, groupModels]) => {
    groupedModels[groupKey] = hasSourceImage
      ? groupModels
      : groupModels.filter((model) => !model.requiresSourceImage);
  });

  const selectedModelConfig = models[value];

  // Sort groups by their order property
  const sortedGroups = Object.entries(modelGroups).sort(
    ([, a], [, b]) => a.order - b.order
  );

  const handleSelect = (modelId) => {
    onChange(modelId);
    setIsOpen(false);
  };

  return (
    <DropdownMenu.Root open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenu.Trigger
        className={`${styles.trigger} ${disabled ? styles.disabled : ''}`}
        disabled={disabled}
      >
        <div className={styles.selectedModel}>
          {selectedModelConfig?.logo && (
            <img
              src={selectedModelConfig.logo}
              alt=""
              className={styles.modelLogo}
            />
          )}
          <span className={styles.modelName}>
            {selectedModelConfig?.name || 'Select Model'}
          </span>
          <CostBadge model={selectedModelConfig} mode={mode} />
        </div>
        <AwesomeIconSimple
          icon={faChevronDown}
          size={12}
          className={styles.arrow}
        />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={styles.content}
          align="start"
          sideOffset={5}
        >
          {sortedGroups.map(([groupKey, groupConfig]) => {
            const models = groupedModels[groupKey];
            if (!models || models.length === 0) return null;

            return (
              <div key={groupKey} className={styles.group}>
                {groupConfig.label && (
                  <DropdownMenu.Label className={styles.groupLabel}>
                    {groupConfig.label}
                  </DropdownMenu.Label>
                )}
                {models.map((model) => (
                  <DropdownMenu.Item
                    key={model.id}
                    className={`${styles.item} ${value === model.id ? styles.selected : ''}`}
                    onSelect={() => handleSelect(model.id)}
                  >
                    <div className={styles.itemContent}>
                      {model.logo && (
                        <img
                          src={model.logo}
                          alt=""
                          className={styles.modelLogo}
                        />
                      )}
                      <span className={styles.modelName}>{model.name}</span>
                      <CostBadge model={model} mode={mode} />
                    </div>
                  </DropdownMenu.Item>
                ))}
              </div>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

export default AIModelSelector;
