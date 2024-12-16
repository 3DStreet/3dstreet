import { useEffect, useState } from 'react';
import styles from './ScreenshotModal.module.scss';
import { signIn } from '../../../api';
import { useAuthContext } from '../../../contexts';
import { Copy32Icon, Save24Icon } from '../../../icons';
import { Button, Dropdown, Input } from '../../components';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import { saveBlob } from '../../../lib/utils';
import { saveScreenshot } from '../../../api/scene';
import useStore from '@/store';
import { convertToObject } from '@/editor/lib/SceneUtils';

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
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const storedScreenshot = localStorage.getItem('screenshot');
  const parsedScreenshot = JSON.parse(storedScreenshot);
  const { currentUser } = useAuthContext();

  const sceneId = STREET.utils.getCurrentSceneId();
  let currentUrl;
  if (sceneId) {
    currentUrl = 'https://3dstreet.app/#/scenes/' + sceneId;
  } else {
    currentUrl = window.location.href;
  }

  const [inputValue, setInputValue] = useState(currentUrl);
  useEffect(() => {
    setInputValue(currentUrl);
  }, [currentUrl]);

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
      onClick: () => exportSceneToGLTF(currentUser?.isPro)
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

  const exportSceneToGLTF = (isPro) => {
    if (isPro) {
      try {
        const sceneName = getSceneName(AFRAME.scenes[0]);
        const scene = AFRAME.scenes[0].object3D;
        posthog.capture('export_scene_to_gltf_clicked', {
          scene_id: STREET.utils.getCurrentSceneId()
        });

        filterHelpers(scene, false);
        AFRAME.INSPECTOR.exporters.gltf.parse(
          scene,
          function (buffer) {
            filterHelpers(scene, true);
            const blob = new Blob([buffer], {
              type: 'application/octet-stream'
            });
            saveBlob(blob, sceneName + '.glb');
          },
          function (error) {
            console.error(error);
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
        updatedUrl = 'https://3dstreet.app/#/scenes/' + sceneId + '.json';
      } else {
        updatedUrl = window.location.href;
      }
      await navigator.clipboard.writeText(updatedUrl);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <Modal
      className={styles.screenshotModalWrapper}
      isOpen={modal === 'screenshot'}
      onClose={() => setModal(null)}
      title={'Share scene'}
      titleElement={
        <>
          <h3
            style={{
              fontSize: '20px',
              marginTop: '26px',
              marginBottom: '0px',
              position: 'relative'
            }}
          >
            Share scene
          </h3>
        </>
      }
    >
      <div className={styles.wrapper}>
        <div className={styles.header}>
          {currentUser ? (
            <div className={styles.forms}>
              <div className={styles.inputContainer}>
                <Input
                  className={styles.input}
                  value={inputValue}
                  readOnly={true}
                  hideBorderAndBackground={true}
                />
                <Button
                  variant="ghost"
                  onClick={copyToClipboardTailing}
                  className={styles.button}
                >
                  <Copy32Icon />
                </Button>
              </div>
              <Dropdown
                placeholder="Download scene as..."
                options={options}
                onSelect={handleSelect}
                selectedOptionValue={selectedOption}
                icon={<Save24Icon />}
                className={styles.dropdown}
              />
            </div>
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
          <div
            className={styles.screenshotWrapper}
            dangerouslySetInnerHTML={{ __html: parsedScreenshot }}
          />
        </div>
      </div>
    </Modal>
  );
}

export { ScreenshotModal };
