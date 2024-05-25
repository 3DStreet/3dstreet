import { useEffect, useRef, useState, useCallback } from 'react';
import ScenePlaceholder from '../../../../../ui_assets/ScenePlaceholder.svg';
import styles from './SceneCard.module.scss';
import { formatDistanceToNow } from 'date-fns';
import { DropdownIcon } from '../../../icons';
import { deleteScene, updateSceneIdAndTitle } from '../../../api/scene';
import { Button } from '../Button';

function LastModified({ timestamp }) {
  // Convert Firestore Timestamp to JavaScript Date object
  const date = timestamp.toDate();

  // Use date-fns to get "time ago" format
  const timeAgo = formatDistanceToNow(date, { addSuffix: true });

  return <span className={styles.date}>Last modified {timeAgo}</span>;
}

const SceneCard = ({
  scenesData,
  handleSceneClick,
  setScenesData,
  isCommunityTabSelected
}) => {
  const [showMenu, setShowMenu] = useState(null);
  const [editIndex, setEditIndex] = useState(null);
  const [editInputValue, setEditInputValue] = useState('');
  const editInputRef = useRef(null);
  const menuRefs = useRef({});

  const toggleMenu = (index) => {
    setShowMenu(showMenu === index ? null : index);
    setEditIndex(null);
  };

  const handleDeleteScene = (scene, e) => {
    e.stopPropagation();

    // Show the system confirm dialog
    const isConfirmed = window.confirm(
      'Are you sure you want to delete this scene?'
    );

    // Only proceed with the delete if the user pressed OK
    if (isConfirmed) {
      deleteScene(scene.id);
      const updatedScenesData = scenesData.filter(
        (item) => item.id !== scene.id
      );
      setScenesData(updatedScenesData);
      setShowMenu(null);
    }
  };

  const handleEditScene = (index) => {
    setEditIndex(index);
    setEditInputValue(scenesData[index].data().title);
    setShowMenu(null);
    // After state updates, focus and select the input content
    setTimeout(() => {
      editInputRef.current.focus();
      editInputRef.current.select();
    }, 0);
  };

  const handleSaveTitle = async () => {
    try {
      const scene = scenesData[editIndex];
      if (!scene) return;

      await updateSceneIdAndTitle(scene.id, editInputValue);

      const updatedScenes = scenesData.map((s) => {
        if (s.id === scene.id) {
          return {
            ...s,
            id: scene.id,
            data: () => ({ ...s.data(), title: editInputValue })
          };
        }
        return s;
      });

      setScenesData(updatedScenes);
      setEditIndex(null);
      STREET.notify.successMessage(`New scene title saved: ${editInputValue}`);
    } catch (error) {
      console.error('Error with update title', error);
      STREET.notify.errorMessage(`Error updating scene title: ${error}`);
    }
  };

  const handleCancelClick = () => {
    if (
      scenesData[editIndex] &&
      scenesData[editIndex].data().title !== undefined
    ) {
      setEditInputValue(scenesData[editIndex].data().title);
    }
    setEditIndex(null);
  };

  const handleChange = (event) => {
    setEditInputValue(event.target.value);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      handleSaveTitle();
    } else if (event.key === 'Escape') {
      handleCancelClick();
    }
  };

  const handleClickOutside = useCallback(
    (event) => {
      if (showMenu !== null) {
        const menuRef = menuRefs.current[showMenu];
        const isClickInsideMenu = menuRef && menuRef.contains(event.target);
        const isClickOnToggle = event.target.closest('.menu-toggle');
        const isClickOnMenuItem = event.target.closest('.menu-item');
        if (!isClickInsideMenu && !isClickOnToggle && !isClickOnMenuItem) {
          setShowMenu(null);
        }
      }
    },
    [showMenu]
  );

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleClickOutside]);

  return (
    <div className={styles.wrapper}>
      {scenesData?.map((scene, index) => (
        <div key={index} className={styles.card} title={scene.data().title}>
          <div
            className={styles.img}
            onClick={(event) => scene.id && handleSceneClick(scene, event)}
            style={{
              backgroundImage: `url(${
                scene.data().imagePath || ScenePlaceholder
              })`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }}
          />
          {showMenu === index && (
            <div className={styles.menuBlock}>
              <div
                className={`${styles.menuItem} menu-item`}
                onClick={() => handleEditScene(index)}
              >
                Edit scene name
              </div>
              <div
                className={`${styles.menuItem} menu-item`}
                onClick={(e) => handleDeleteScene(scene, e)}
              >
                Delete scene
              </div>
            </div>
          )}
          <div>
            {editIndex === index ? (
              <input
                ref={editInputRef}
                type="text"
                defaultValue={scene.data().title}
                className={styles.editInput}
                onChange={handleChange}
                value={editInputValue}
                onKeyDown={handleKeyDown}
              />
            ) : (
              <p className={styles.title}>{scene.data().title}</p>
            )}
          </div>
          {editIndex !== index ? (
            <>
              <div className={styles.userBlock}>
                <div className={styles.userName}>
                  {/* Placeholder for username + thumbnail support */}
                  {/* <img src={'../../../../../ui_assets/avatar.svg'} alt="avatar" /> */}
                  {/* <p>User Name</p> */}
                  <p>
                    <LastModified timestamp={scene.data().updateTimestamp} />
                  </p>
                </div>
                {!isCommunityTabSelected && (
                  <div
                    ref={(el) => (menuRefs.current[index] = el)}
                    onClick={(e) => toggleMenu(index, e)}
                  >
                    <DropdownIcon className="menu-toggle" />
                  </div>
                )}
              </div>
              {/* Placeholder to return LastModified here when username + thumbnail done */}
              {/* <p className={styles.date}>
                <LastModified timestamp={scene.data().updateTimestamp} />
              </p> */}
            </>
          ) : (
            <div className={styles.editButtons}>
              <Button
                variant="toolbtn"
                className={styles.editButton}
                onClick={handleSaveTitle}
                disabled={editInputValue === scene.data().title}
              >
                Save changes
              </Button>
              <Button
                variant="toolbtn"
                className={styles.editButton}
                onClick={handleCancelClick}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export { SceneCard };
