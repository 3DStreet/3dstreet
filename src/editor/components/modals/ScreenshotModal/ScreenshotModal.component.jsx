import { useState } from 'react';
import { ScreenshotProperties } from './ScreenshotProperties.component.jsx';
import styles from './ScreenshotModal.module.scss';
import { signIn } from '../../../api';
import { useAuthContext } from '../../../contexts';
import { Copy32Icon, Save24Icon } from '../../../icons';
import { Button, Dropdown } from '../../components';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import { saveBlob } from '../../../lib/utils';
import { saveScreenshot } from '../../../api/scene';
import useStore from '@/store';
import { convertToObject } from '@/editor/lib/SceneUtils';
import { transformUVs, addGLBMetadata } from './gltfTransforms';

const filterHelpers = (scene, visible) => {
  scene.traverse((o) => {
    if (o.userData.source === 'INSPECTOR') {
      o.visible = visible;
    }
  });
};

/**
 * Slugify the string removing non-word chars and spaces
 * @param  {string} text String to slugify
 * @return {string}      Slugified string
 */
const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, '-') // Replace spaces with -
    .replace(/[^\w-]+/g, '-') // Replace all non-word chars with -
    .replace(/--+/g, '-') // Replace multiple - with single -
    .replace(/^-+/, '') // Trim - from start of text
    .replace(/-+$/, ''); // Trim - from end of text
};

const getSceneName = (scene) => {
  return scene.id || slugify(window.location.host + window.location.pathname);
};

function ScreenshotModal() {
  // Get the entity that has the screentock component
  const getScreentockEntity = () => {
    const screenshotEl = document.getElementById('screenshot');
    if (!screenshotEl.isPlaying) {
      screenshotEl.play();
    }
    return screenshotEl;
  };
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const { currentUser } = useAuthContext();

  const [selectedOption, setSelectedOption] = useState(null);
  const options = [
    {
      value: 'PNG',
      label: 'PNG',
      onClick: () => saveScreenshot('png')
    },
    {
      value: 'JPG',
      label: 'JPG',
      onClick: () => saveScreenshot('jpg')
    },
    {
      value: 'GLB glTF',
      label: 'GLB glTF',
      proIcon: true,
      onClick: () => exportSceneToGLTF(currentUser?.isPro, false)
    },
    {
      value: 'AR Ready GLB',
      label: '`AR Ready` GLB',
      proIcon: true,
      onClick: () => exportSceneToGLTF(currentUser?.isPro, true)
    },
    {
      value: '.3dstreet.json',
      label: '.3dstreet.json',
      onClick: () => {
        posthog.capture('convert_to_json_clicked', {
          scene_id: STREET.utils.getCurrentSceneId()
        });
        convertToObject();
      }
    }
  ];

  const handleSelect = (value) => {
    setSelectedOption(value);
  };

  const getMixinCategories = () => {
    const mapping = {};
    const mixinElements = document.querySelectorAll('a-mixin');
    for (let mixinEl of Array.from(mixinElements)) {
      const category = mixinEl.getAttribute('category');
      if (category) {
        mapping[mixinEl.id] = category;
      }
    }
    return mapping;
  };

  const filterRiggedEntities = (scene, visible) => {
    const mixinToCategory = getMixinCategories();

    scene.traverse((node) => {
      if (node.el && node.el.components) {
        const mixin = node.el.getAttribute('mixin');
        if (mixin) {
          const category = mixinToCategory[mixin];
          if (
            category &&
            (category.includes('people') ||
              category.includes('people-rigged') ||
              category.includes('vehicles') ||
              category.includes('vehicles-transit') ||
              category.includes('cyclists'))
          ) {
            node.visible = visible;
            console.log(
              'Hiding Rigged Entity',
              node.el.id || 'unnamed',
              'category:',
              category
            );
          }
        }
      }
    });
  };
  const exportSceneToGLTF = (isPro, arReady) => {
    if (isPro) {
      try {
        const sceneName = getSceneName(AFRAME.scenes[0]);
        let scene = AFRAME.scenes[0].object3D;
        if (arReady) {
          // only export user layers, not geospatial
          scene = document.querySelector('#street-container').object3D;
        }
        posthog.capture('export_scene_to_gltf_clicked', {
          scene_id: STREET.utils.getCurrentSceneId()
        });

        // if AR Ready mode, then remove rigged vehicles and people from the scene
        if (arReady) {
          filterRiggedEntities(scene, false);
        }
        filterHelpers(scene, false);
        // Modified to handle post-processing
        AFRAME.INSPECTOR.exporters.gltf.parse(
          scene,
          async function (buffer) {
            filterHelpers(scene, true);
            filterRiggedEntities(scene, true);

            let finalBuffer = buffer;

            // Post-process GLB if AR Ready option is selected
            if (arReady) {
              try {
                finalBuffer = await transformUVs(buffer);
                console.log('Successfully post-processed GLB file');
              } catch (error) {
                console.warn('Error in GLB post-processing:', error);
                // Fall back to original buffer if post-processing fails
                STREET.notify.warningMessage(
                  'UV transformation skipped - using original export'
                );
              }
            }

            // fetch metadata from scene
            const geoLayer = document.getElementById('reference-layers');
            if (geoLayer && geoLayer.hasAttribute('street-geo')) {
              const metadata = {
                longitude: geoLayer.getAttribute('street-geo').longitude,
                latitude: geoLayer.getAttribute('street-geo').latitude,
                orthometricHeight:
                  geoLayer.getAttribute('street-geo').orthometricHeight,
                geoidHeight: geoLayer.getAttribute('street-geo').geoidHeight,
                ellipsoidalHeight:
                  geoLayer.getAttribute('street-geo').ellipsoidalHeight,
                orientation: 270
              };
              finalBuffer = await addGLBMetadata(finalBuffer, metadata);
              console.log('Successfully added geospatial metadata to GLB file');
            }
            const blob = new Blob([finalBuffer], {
              type: 'application/octet-stream'
            });
            saveBlob(blob, sceneName + '.glb');
          },
          function (error) {
            console.error(error);
            STREET.notify.errorMessage(
              `Error while trying to save glTF file. Error: ${error}`
            );
          },
          { binary: true }
        );
        STREET.notify.successMessage('3DStreet scene exported as glTF file.');
      } catch (error) {
        STREET.notify.errorMessage(
          `Error while trying to save glTF file. Error: ${error}`
        );
        console.error(error);
      }
    } else {
      setModal('payment');
    }
  };

  const copyToClipboardTailing = async () => {
    try {
      const sceneId = STREET.utils.getCurrentSceneId();
      let updatedUrl;
      if (sceneId) {
        updatedUrl = 'https://3dstreet.app/#/scenes/' + sceneId;
      } else {
        updatedUrl = window.location.href;
      }
      await navigator.clipboard.writeText(updatedUrl);
      STREET.notify.successMessage('Scene URL copied to clipboard');
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <Modal
      className={styles.screenshotModalWrapper}
      isOpen={modal === 'screenshot'}
      onClose={() => setModal(null)}
      titleElement={
        <div className="flex items-center justify-between pr-4 pt-4">
          <div className="font-large text-center text-2xl">Share Scene</div>
          <Button
            onClick={copyToClipboardTailing}
            leadingIcon={<Copy32Icon />}
            variant="toolbtn"
          >
            Copy Link
          </Button>
        </div>
      }
    >
      <div className={styles.wrapper}>
        <div className="details">
          <Dropdown
            placeholder="Download scene as..."
            options={options}
            onSelect={handleSelect}
            selectedOptionValue={selectedOption}
            icon={<Save24Icon />}
            className={styles.dropdown}
          />
          <ScreenshotProperties entity={getScreentockEntity()} />
        </div>
        <div className={styles.mainContent}>
          <div className={styles.header}>
            {currentUser ? (
              <></>
            ) : (
              <div>
                <h3>Please log in first to share the URL</h3>
                <Button onClick={() => signIn()}>
                  Sign in to 3DStreet Cloud
                </Button>
              </div>
            )}
          </div>
          <div className={styles.imageWrapper}>
            <div className={styles.screenshotWrapper}>
              <img id="screentock-destination" />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { ScreenshotModal };
