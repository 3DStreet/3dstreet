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

const AIModelSelector = ({
  value,
  onChange,
  disabled = false,
  mode = 'image' // 'image' or 'video'
}) => {
  const [isOpen, setIsOpen] = useState(false);

  // Select appropriate models and groups based on mode
  const models = mode === 'video' ? VIDEO_MODELS : REPLICATE_MODELS;
  const modelGroups = mode === 'video' ? VIDEO_MODEL_GROUPS : MODEL_GROUPS;
  const groupedModels =
    mode === 'video' ? getGroupedVideoModels() : getGroupedModels();

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
          {mode === 'image' &&
            selectedModelConfig?.tokenCost &&
            selectedModelConfig.tokenCost >= 1 && (
              <TokenDisplayBase
                count={selectedModelConfig.tokenCost}
                inline={true}
                compact={true}
                className={styles.tokenCostBadge}
              />
            )}
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
                <DropdownMenu.Label className={styles.groupLabel}>
                  {groupConfig.label}
                </DropdownMenu.Label>
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
                      {mode === 'image' &&
                        model.tokenCost &&
                        model.tokenCost >= 1 && (
                          <TokenDisplayBase
                            count={model.tokenCost}
                            inline={true}
                            compact={true}
                            className={styles.tokenCostBadge}
                          />
                        )}
                    </div>
                  </DropdownMenu.Item>
                ))}
                {groupKey !== sortedGroups[sortedGroups.length - 1][0] && (
                  <DropdownMenu.Separator className={styles.separator} />
                )}
              </div>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
};

export default AIModelSelector;
