import { useState, useEffect, useCallback } from 'react';
import styles from './UsernameEditor.module.scss';
import {
  validateUsernameFormat,
  checkUsernameAvailability,
  updateUsername
} from '../../../utils/username';
import { Button } from '../Button';
import { Loader } from '../../../icons';
import { debounce } from 'lodash-es';

const UsernameEditor = ({ currentUsername, userId, onUpdate }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [username, setUsername] = useState(currentUsername);
  const [originalUsername, setOriginalUsername] = useState(currentUsername);
  const [validationState, setValidationState] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Debounced username validation
  const checkUsername = useCallback(
    debounce(async (value) => {
      if (value === originalUsername) {
        setValidationState(null);
        setIsChecking(false);
        return;
      }

      const formatValidation = validateUsernameFormat(value);
      if (!formatValidation.valid) {
        setValidationState({
          valid: false,
          message: formatValidation.error
        });
        setIsChecking(false);
        return;
      }

      try {
        const isAvailable = await checkUsernameAvailability(value);
        setValidationState({
          valid: isAvailable,
          message: isAvailable ? 'Available' : 'Username already taken'
        });
      } catch (error) {
        setValidationState({
          valid: false,
          message: 'Error checking availability'
        });
      }
      setIsChecking(false);
    }, 500),
    [originalUsername]
  );

  useEffect(() => {
    if (isEditing && username !== originalUsername) {
      setIsChecking(true);
      checkUsername(username);
    }
  }, [username, isEditing, originalUsername, checkUsername]);

  const handleEdit = () => {
    setIsEditing(true);
    setOriginalUsername(currentUsername);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setUsername(originalUsername);
    setValidationState(null);
  };

  const handleSave = async () => {
    if (!validationState?.valid) return;

    setIsSaving(true);
    try {
      const updatedUsername = await updateUsername(userId, username);
      setOriginalUsername(updatedUsername);
      setIsEditing(false);
      setValidationState(null);
      if (onUpdate) {
        onUpdate(updatedUsername);
      }
    } catch (error) {
      setValidationState({
        valid: false,
        message: error.message
      });
    }
    setIsSaving(false);
  };

  const handleInputChange = (e) => {
    const value = e.target.value.toLowerCase();
    setUsername(value);
  };

  return (
    <div className={styles.usernameEditor}>
      {!isEditing ? (
        <div className={styles.display}>
          <span className={styles.label}>Username:</span>
          <span className={styles.username}>@{currentUsername}</span>
          <Button
            type="ghost"
            className={styles.editButton}
            onClick={handleEdit}
          >
            Edit
          </Button>
        </div>
      ) : (
        <div className={styles.editor}>
          <div className={styles.inputWrapper}>
            <span className={styles.prefix}>@</span>
            <input
              type="text"
              value={username}
              onChange={handleInputChange}
              className={styles.input}
              maxLength={25}
              autoFocus
            />
            {isChecking && <Loader className={styles.loader} />}
          </div>

          {validationState && (
            <div
              className={`${styles.validation} ${validationState.valid ? styles.valid : styles.invalid}`}
            >
              <span>
                {validationState.valid ? '✓' : '✗'} {validationState.message}
              </span>
            </div>
          )}

          <div className={styles.actions}>
            <Button type="ghost" onClick={handleCancel} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              type="filled"
              onClick={handleSave}
              disabled={!validationState?.valid || isSaving}
            >
              {isSaving ? <Loader className={styles.buttonLoader} /> : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UsernameEditor;
