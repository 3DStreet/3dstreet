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
    if (event.key === 'Enter') {
      inputRef.current?.blur();
    } else if (event.key === 'Escape') {
      cancelledRef.current = true;
      inputRef.current?.blur();
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
