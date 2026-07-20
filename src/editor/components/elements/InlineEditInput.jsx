import PropTypes from 'prop-types';
import { useEffect, useRef } from 'react';

/**
 * Text input for in-place renaming. Focuses and selects its content on
 * mount; Enter (or blur) commits via onCommit, Escape cancels. onClose fires
 * in both cases so the parent can leave edit mode. Validation (empty or
 * unchanged values) is the caller's responsibility.
 */
const InlineEditInput = ({
  defaultValue,
  onCommit,
  onClose,
  ...inputProps
}) => {
  const inputRef = useRef(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const onKeyDown = (event) => {
    // Enter/Escape commit or cancel the rename here; stop them from bubbling to
    // the global editor shortcuts (clone on "d", delete, etc.) and from any
    // default action. Without this, committing a rename could also trigger a
    // sidebar button / shortcut still in the key event's path. Matches the
    // InputWidget property-field pattern.
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelledRef.current = true;
      inputRef.current?.blur();
    }
  };

  // The commit blurs on keydown, so the matching keyup usually lands after the
  // field is gone; guard the keyup too in case focus is still on the field, so
  // it can never reach the keyup-based global shortcuts (clone/delete/etc.).
  const onKeyUp = (event) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.stopPropagation();
    }
  };

  const onBlur = (event) => {
    const cancelled = cancelledRef.current;
    cancelledRef.current = false;
    onClose();
    if (!cancelled) {
      onCommit(event.target.value);
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      defaultValue={defaultValue}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      {...inputProps}
    />
  );
};

InlineEditInput.propTypes = {
  defaultValue: PropTypes.string,
  onCommit: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired
};

export default InlineEditInput;
