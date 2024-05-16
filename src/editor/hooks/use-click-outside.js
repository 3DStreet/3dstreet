import { useCallback, useEffect } from 'react';

/**
 * useClickOutside hook.
 * Used fo invoking callbacks, when clicking outside the ref element.
 *
 * @author Oleksii Medvediev
 * @category Hooks
 * @param { RefObject<HTMLElement> } ref - ref element to watch on.
 * @param { Function } handleClickOutside - a callback function invoked when clicked outside the ref element.
 */
const useClickOutside = (ref, handleClickOutside) => {
  const handleClick = useCallback(
    (event) => {
      if (
        ref.current &&
        !ref.current.contains(event.target) &&
        event.button !== 2
      ) {
        handleClickOutside();
      }
    },
    [handleClickOutside, ref]
  );

  useEffect(() => {
    document.addEventListener('pointerdown', handleClick);
    return () => document.removeEventListener('pointerdown', handleClick);
  }, [handleClick]);
};

export { useClickOutside };
