/* global AFRAME, STREET */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FormattedMessage, defineMessages, useIntl } from 'react-intl';
import { Tooltip } from 'radix-ui';
import {
  faRotateRight,
  faTrash,
  faUndo,
  faRedo
} from '@fortawesome/free-solid-svg-icons';
import posthog from 'posthog-js';
import useStore from '@/store';
import Events from '../../../lib/Events';
import { getGroupedMixinOptions } from '../../../lib/mixinUtils';
import { getEmptyDragImage } from '@shared/utils/dragImage.js';
import CardPlaceholder from '../../../../../ui_assets/card-placeholder.svg';
import { Button } from '../Button';
import { AwesomeIcon } from '../AwesomeIcon';
import { ToolTip } from '../PrimaryToolbar/PrimaryToolbar';
import styles from './BuildPalette.module.scss';

// dataTransfer type for a palette card drag; distinct from the editor's
// Add Layer payloads so the two drop paths never read each other.
const BUILD_CARD_MIME = 'application/x-3dstreet-build';

const notices = defineMessages({
  outside: {
    id: 'buildArea.notice.outside',
    defaultMessage: 'Drop it inside a build area.'
  },
  palette: {
    id: 'buildArea.notice.palette',
    defaultMessage: 'That object is not available in this build area.'
  },
  full: {
    id: 'buildArea.notice.full',
    defaultMessage: 'This build area is full.'
  },
  keepInside: {
    id: 'buildArea.notice.keepInside',
    defaultMessage: 'Objects stay inside the build area.'
  }
});

const getSystem = () => AFRAME.scenes[0]?.systems?.['build-area'] ?? null;

// The selected entity, tracked reactively; only visitor objects can be
// selected while a build session is active (raycaster.js).
function useSelectedVisitorObject(active) {
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    if (!active) {
      setSelected(null);
      return undefined;
    }
    const update = (entity) =>
      setSelected(
        entity && entity.hasAttribute?.('data-viewer-added') ? entity : null
      );
    update(AFRAME.INSPECTOR?.selectedEntity || null);
    Events.on('entityselect', update);
    return () => Events.off('entityselect', update);
  }, [active]);
  return selected;
}

/**
 * Visitor Build palette dock (docs/visitor-build.md). Shown while a play
 * session in the viewer has a buildable area (build-area system). Cards
 * are the union of the areas' palettes: drag one onto a build area to
 * place it there, or tap it to drop it at the centre of the view. The
 * small toolbar acts on the selected visitor object (rotate, delete,
 * undo/redo); keyboard: Delete/Backspace, Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z,
 * Escape deselects before it stops the session.
 */
export const BuildPalette = () => {
  const intl = useIntl();
  const active = useStore((s) => s.buildSessionActive);
  const placedCount = useStore((s) => s.buildPlacedCount);
  const selected = useSelectedVisitorObject(active);
  const [paletteVersion, setPaletteVersion] = useState(0);

  // Palette ids → card data (name, thumbnail) from the loaded mixins.
  const cards = useMemo(() => {
    if (!active) return [];
    const system = getSystem();
    const ids = system ? system.getPalette() : [];
    const byId = new Map();
    for (const group of getGroupedMixinOptions(true)) {
      for (const option of group.options) byId.set(option.mixinId, option);
    }
    return ids.map(
      (id) =>
        byId.get(id) || { mixinId: id, name: id, img: '', description: '' }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, paletteVersion]);

  // The author may edit palettes while previewing from the editor... no:
  // the editor is closed while playing. Re-read on a new scene only.
  useEffect(() => {
    const sceneEl = AFRAME.scenes[0];
    if (!sceneEl) return undefined;
    const bump = () => setPaletteVersion((v) => v + 1);
    sceneEl.addEventListener('newScene', bump);
    return () => sceneEl.removeEventListener('newScene', bump);
  }, []);

  // Refusals named by the system, localized here.
  useEffect(() => {
    const sceneEl = AFRAME.scenes[0];
    if (!sceneEl) return undefined;
    const onNotice = (evt) => {
      const message = notices[evt.detail?.reason];
      if (message) STREET.notify?.warningMessage(intl.formatMessage(message));
    };
    sceneEl.addEventListener('build-area-notice', onNotice);
    return () => sceneEl.removeEventListener('build-area-notice', onNotice);
  }, [intl]);

  const place = useCallback((mixinId, clientX, clientY) => {
    const entity = getSystem()?.placeMixin(mixinId, clientX, clientY);
    if (entity) {
      posthog.capture('visitor_build_placed', {
        scene_id: STREET.utils.getCurrentSceneId(),
        mixin_id: mixinId,
        via: clientX === undefined ? 'tap' : 'drop'
      });
    }
    return entity;
  }, []);

  // Drop onto the canvas: the card carries its mixin id; everything else
  // (files, editor payloads) is left alone. Window-level so the drop
  // works wherever the pointer lands over the scene.
  useEffect(() => {
    if (!active) return undefined;
    const onDragOver = (e) => {
      if (!e.dataTransfer?.types?.includes(BUILD_CARD_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e) => {
      const mixinId = e.dataTransfer?.getData?.(BUILD_CARD_MIME);
      if (!mixinId) return;
      e.preventDefault();
      e.stopPropagation();
      place(mixinId, e.clientX, e.clientY);
    };
    document.body.addEventListener('dragover', onDragOver);
    document.body.addEventListener('drop', onDrop);
    return () => {
      document.body.removeEventListener('dragover', onDragOver);
      document.body.removeEventListener('drop', onDrop);
    };
  }, [active, place]);

  const rotateSelected = useCallback(() => {
    if (!selected) return;
    if (
      selected.parentEl?.components?.['build-area']?.data?.allowRotate === false
    ) {
      return;
    }
    const rotation = selected.getAttribute('rotation') || { x: 0, y: 0, z: 0 };
    // String value, the same shape the gizmo commits (viewport.js).
    AFRAME.INSPECTOR.execute('entityupdate', {
      entity: selected,
      component: 'rotation',
      value: `${rotation.x} ${(rotation.y + 90) % 360} ${rotation.z}`
    });
  }, [selected]);

  const deleteSelected = useCallback(() => {
    if (!selected) return;
    AFRAME.INSPECTOR.execute('entityremove', selected);
  }, [selected]);

  // Undo stops at the session's Start mark (build-area.canUndo): past it
  // would pop the author's own editor commands.
  const undo = useCallback(() => {
    if (getSystem()?.canUndo()) AFRAME.INSPECTOR.undo();
  }, []);
  const redo = useCallback(() => AFRAME.INSPECTOR.redo(), []);

  // Keyboard, capture phase so Escape with a selection deselects and
  // stops there (the viewer toolbar's Escape sees defaultPrevented).
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (e) => {
      const a = document.activeElement;
      if (
        a &&
        (a.tagName === 'INPUT' ||
          a.tagName === 'TEXTAREA' ||
          a.tagName === 'SELECT' ||
          a.isContentEditable)
      ) {
        return;
      }
      if (useStore.getState().modal) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (
        (e.code === 'Delete' || e.code === 'Backspace') &&
        AFRAME.INSPECTOR?.selectedEntity?.hasAttribute?.('data-viewer-added')
      ) {
        e.preventDefault();
        AFRAME.INSPECTOR.execute(
          'entityremove',
          AFRAME.INSPECTOR.selectedEntity
        );
      } else if (e.code === 'Escape' && AFRAME.INSPECTOR?.selectedEntity) {
        e.preventDefault();
        AFRAME.INSPECTOR.selectEntity(null);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [active, undo, redo]);

  if (!active) return null;

  const canRotate =
    !!selected &&
    selected.parentEl?.components?.['build-area']?.data?.allowRotate !== false;

  return (
    <div className={`clickable ${styles.dock}`} id="build-palette">
      <div className={styles.header}>
        <span>
          <FormattedMessage
            id="buildArea.dockTitle"
            defaultMessage="Drag an object onto the highlighted area, or tap to place it"
          />
        </span>
        <span className={styles.counter}>
          <FormattedMessage
            id="buildArea.placedCount"
            defaultMessage="{count, plural, one {# object} other {# objects}}"
            values={{ count: placedCount }}
          />
        </span>
      </div>
      <div className={styles.cards}>
        {/* Cards are divs, not buttons: Chromium never starts a native drag
            from a form control, so a draggable <button> is tap-only.
            Keyboard activation is restored by hand (Enter / Space). */}
        {cards.map((card) => (
          <div
            key={card.mixinId}
            role="button"
            tabIndex={0}
            className={styles.card}
            draggable
            title={card.description || card.name}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                place(card.mixinId);
              }
            }}
            onDragStart={(e) => {
              e.stopPropagation();
              if (!e.dataTransfer) return;
              e.dataTransfer.effectAllowed = 'copy';
              e.dataTransfer.setData(BUILD_CARD_MIME, card.mixinId);
              e.dataTransfer.setDragImage(getEmptyDragImage(), 0, 0);
            }}
            onClick={() => place(card.mixinId)}
          >
            <div
              className={styles.cardImg}
              style={{ backgroundImage: `url(${card.img || CardPlaceholder})` }}
            />
            <span className={styles.cardName}>{card.name}</span>
          </div>
        ))}
      </div>
      <div className={styles.tools}>
        <Tooltip.Provider>
          <ToolTip
            content={intl.formatMessage({
              id: 'buildArea.rotateTitle',
              defaultMessage: 'Rotate the selected object 90°'
            })}
          >
            <Button
              variant="toolbtn"
              disabled={!canRotate}
              onClick={rotateSelected}
              leadingIcon={<AwesomeIcon icon={faRotateRight} size={14} />}
            >
              <FormattedMessage id="buildArea.rotate" defaultMessage="Rotate" />
            </Button>
          </ToolTip>
          <ToolTip
            content={intl.formatMessage({
              id: 'buildArea.deleteTitle',
              defaultMessage: 'Remove the selected object (Delete)'
            })}
          >
            <Button
              variant="toolbtn"
              disabled={!selected}
              onClick={deleteSelected}
              leadingIcon={<AwesomeIcon icon={faTrash} size={14} />}
            >
              <FormattedMessage id="buildArea.delete" defaultMessage="Delete" />
            </Button>
          </ToolTip>
          <ToolTip
            content={intl.formatMessage({
              id: 'buildArea.undoTitle',
              defaultMessage: 'Undo (Ctrl/Cmd+Z)'
            })}
          >
            <Button
              variant="toolbtn"
              onClick={undo}
              leadingIcon={<AwesomeIcon icon={faUndo} size={14} />}
            >
              <FormattedMessage id="buildArea.undo" defaultMessage="Undo" />
            </Button>
          </ToolTip>
          <ToolTip
            content={intl.formatMessage({
              id: 'buildArea.redoTitle',
              defaultMessage: 'Redo (Shift+Ctrl/Cmd+Z)'
            })}
          >
            <Button
              variant="toolbtn"
              onClick={redo}
              leadingIcon={<AwesomeIcon icon={faRedo} size={14} />}
            >
              <FormattedMessage id="buildArea.redo" defaultMessage="Redo" />
            </Button>
          </ToolTip>
        </Tooltip.Provider>
        <span className={styles.hint}>
          {selected ? (
            <FormattedMessage
              id="buildArea.hintSelected"
              defaultMessage="Drag the arrows to move it."
            />
          ) : (
            <FormattedMessage
              id="buildArea.hintIdle"
              defaultMessage="Click an object you placed to move it."
            />
          )}
        </span>
      </div>
    </div>
  );
};

export default BuildPalette;
