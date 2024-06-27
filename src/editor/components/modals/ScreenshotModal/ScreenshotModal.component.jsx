import { useEffect, useState } from 'react';
import styles from './ScreenshotModal.module.scss';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc
} from 'firebase/firestore';

import { signIn } from '../../../api';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import PropTypes from 'prop-types';
import { useAuthContext } from '../../../contexts';
import { Copy32Icon, Save24Icon } from '../../../icons';
import { db, storage } from '../../../services/firebase';
import { Button, Dropdown, Input } from '../../components';
import Toolbar from '../../scenegraph/Toolbar';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
// import { loginHandler } from '../SignInModal';

export const uploadThumbnailImage = async (uploadedFirstTime) => {
  try {
    saveScreenshot('img');

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const screentockImgElement = document.getElementById(
      'screentock-destination'
    );

    // Get the original image dimensions
    const originalWidth = screentockImgElement.naturalWidth;
    const originalHeight = screentockImgElement.naturalHeight;

    // Define the target dimensions
    const targetWidth = 320;
    const targetHeight = 240;

    // Calculate the scale factors
    const scaleX = targetWidth / originalWidth;
    const scaleY = targetHeight / originalHeight;

    // Use the larger scale factor to fill the entire space
    const scale = Math.max(scaleX, scaleY);

    // Calculate the new dimensions
    const newWidth = originalWidth * scale;
    const newHeight = originalHeight * scale;

    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = targetWidth;
    resizedCanvas.height = targetHeight;
    const context = resizedCanvas.getContext('2d');

    // Calculate the position to center the image
    const posX = (targetWidth - newWidth) / 2;
    const posY = (targetHeight - newHeight) / 2;

    // Draw the image on the canvas with the new dimensions and position
    context.drawImage(screentockImgElement, posX, posY, newWidth, newHeight);
    // Rest of the code...
    const thumbnailDataUrl = resizedCanvas.toDataURL('image/jpeg', 0.5);
    const blobFile = await fetch(thumbnailDataUrl).then((res) => res.blob());

    const sceneDocId = STREET.utils.getCurrentSceneId();

    const thumbnailRef = ref(storage, `scenes/${sceneDocId}/files/preview.jpg`);

    const uploadedImg = await uploadBytes(thumbnailRef, blobFile);

    const downloadURL = await getDownloadURL(uploadedImg.ref);
    const userScenesRef = collection(db, 'scenes');
    const sceneDocRef = doc(userScenesRef, sceneDocId);
    const sceneSnapshot = await getDoc(sceneDocRef);
    if (sceneSnapshot.exists()) {
      await updateDoc(sceneDocRef, {
        imagePath: downloadURL,
        updateTimestamp: serverTimestamp()
      });
      console.log('Firebase updateDoc fired');
    } else {
      throw new Error('No existing sceneSnapshot exists.');
    }

    console.log('Thumbnail uploaded and Firestore updated successfully.');
    uploadedFirstTime &&
      STREET.notify.successMessage(
        'Scene thumbnail updated in 3DStreet Cloud.'
      );
  } catch (error) {
    console.error('Error capturing screenshot and updating Firestore:', error);
    let errorMessage = `Error updating scene thumbnail: ${error}`;
    if (error.code === 'storage/unauthorized') {
      errorMessage =
        'Error updating scene thumbnail: only the scene author may change the scene thumbnail. Save this scene as your own to change the thumbnail.';
    }
    STREET.notify.errorMessage(errorMessage);
  }
};

const saveScreenshot = async (value) => {
  const screenshotEl = document.getElementById('screenshot');
  screenshotEl.play();

  if (value === 'img') {
    screenshotEl.setAttribute(
      'screentock',
      'imgElementSelector',
      '#screentock-destination'
    );
  }

  posthog.capture('screenshot_taken', {
    type: value,
    scene_id: STREET.utils.getCurrentSceneId()
  });

  screenshotEl.setAttribute('screentock', 'type', value);
  screenshotEl.setAttribute('screentock', 'takeScreenshot', true);
};

function ScreenshotModal({ isOpen, onClose }) {
  const storedScreenshot = localStorage.getItem('screenshot');
  const parsedScreenshot = JSON.parse(storedScreenshot);
  const { currentUser } = useAuthContext();

  const sceneId = STREET.utils.getCurrentSceneId();
  let currentUrl;
  if (sceneId) {
    currentUrl = 'https://3dstreet.app/#/scenes/' + sceneId + '.json';
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
      onClick: Toolbar.exportSceneToGLTF
    },
    {
      value: '.3dstreet.json',
      label: '.3dstreet.json',
      onClick: Toolbar.convertToObject
    }
  ];

  const handleSelect = (value) => {
    setSelectedOption(value);
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
      isOpen={isOpen}
      onClose={onClose}
      extraCloseKeyCode={72}
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
          <Button
            variant="custom"
            onClick={uploadThumbnailImage}
            className={styles.thumbnailButton}
          >
            Set as scene thumbnail
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ScreenshotModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func.isRequired
};

export { ScreenshotModal };
