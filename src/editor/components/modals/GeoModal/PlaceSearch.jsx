import { useCallback, useEffect, useRef, useState } from 'react';
import { func, string } from 'prop-types';
import classnames from 'classnames';
import { Magnifier20Icon } from '@shared/icons';
import { Input } from '../../elements/index.js';
import styles from './GeoModal.module.scss';

const SUGGEST_DEBOUNCE_MS = 250;

/**
 * Location search box backed by the Places API (New): our own input and
 * suggestion list over `AutocompleteSuggestion`, replacing the legacy
 * `places.Autocomplete` widget (closed to new customers). The browser key
 * needs "Places API (New)" enabled. Expects the Maps `places` library loaded.
 *
 * - `onPick(lat, lng)`: a suggestion was chosen.
 * - `onSubmitQuery(text)`: Enter with no suggestion highlighted; the parent
 *   geocodes the raw text (#1897).
 * - `onQueryChange(text)`: every edit, so Set Location can geocode unpicked text.
 */
const PlaceSearch = ({
  className,
  placeholder,
  onPick,
  onSubmitQuery,
  onQueryChange
}) => {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [active, setActive] = useState(-1);
  // Groups keystrokes and the final place lookup into one billed session.
  const sessionRef = useRef(null);
  // Latest request wins; older responses are dropped.
  const requestIdRef = useRef(0);
  const debounceRef = useRef(null);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const closeList = useCallback(() => {
    requestIdRef.current += 1;
    clearTimeout(debounceRef.current);
    setSuggestions([]);
    setActive(-1);
  }, []);

  const fetchSuggestions = async (input, requestId) => {
    const { AutocompleteSuggestion, AutocompleteSessionToken } =
      window.google.maps.places;
    sessionRef.current ??= new AutocompleteSessionToken();
    try {
      const response =
        await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input,
          sessionToken: sessionRef.current
        });
      if (requestId !== requestIdRef.current) return;
      setSuggestions(
        response.suggestions.map((s) => s.placePrediction).filter(Boolean)
      );
      setActive(-1);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      // Search degrades to geocoding the typed text on Enter / Set Location.
      console.warn('Place suggestions unavailable:', error?.message || error);
      setSuggestions([]);
    }
  };

  const onChange = (value) => {
    setText(value);
    onQueryChange(value);
    closeList();
    const input = value.trim();
    if (!input) return;
    const requestId = requestIdRef.current;
    debounceRef.current = setTimeout(
      () => fetchSuggestions(input, requestId),
      SUGGEST_DEBOUNCE_MS
    );
  };

  const pick = async (prediction) => {
    closeList();
    const label = prediction.text.text;
    setText(label);
    const place = prediction.toPlace();
    try {
      await place.fetchFields({ fields: ['location'] });
    } catch (error) {
      console.warn('Place lookup failed:', error?.message || error);
    }
    // A details lookup ends the session; the next keystroke starts a new one.
    sessionRef.current = null;
    if (place.location) {
      onPick(place.location.lat(), place.location.lng());
    } else {
      onSubmitQuery(label);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!suggestions.length) return;
      event.preventDefault();
      // -1 is "back in the text box".
      setActive((i) =>
        event.key === 'ArrowDown'
          ? Math.min(i + 1, suggestions.length - 1)
          : Math.max(i - 1, -1)
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active >= 0 && suggestions[active]) {
        pick(suggestions[active]);
      } else if (text.trim()) {
        closeList();
        onSubmitQuery(text.trim());
      }
    }
  };

  // Escape closes an open list without closing the modal, which listens for
  // keyup on document; stopping it at React's root keeps it from getting there.
  const onKeyUp = (event) => {
    if (event.key === 'Escape' && suggestions.length) {
      event.stopPropagation();
      closeList();
    }
  };

  const isOpen = suggestions.length > 0;

  return (
    <div className={styles.placeSearch}>
      <Input
        className={className}
        leadingIcon={<Magnifier20Icon />}
        placeholder={placeholder}
        value={text}
        onChange={onChange}
        inputProps={{
          onKeyDown,
          onKeyUp,
          onBlur: closeList,
          autoComplete: 'off',
          role: 'combobox',
          'aria-expanded': isOpen,
          'aria-autocomplete': 'list',
          'aria-controls': 'geo-place-suggestions'
        }}
      />
      {isOpen && (
        <ul
          id="geo-place-suggestions"
          role="listbox"
          className={styles.placeSuggestions}
        >
          {suggestions.map((prediction, i) => (
            <li
              key={prediction.placeId}
              role="option"
              aria-selected={i === active}
              className={classnames(i === active && styles.activeSuggestion)}
              // mousedown would blur the input and close the list before click.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(prediction)}
            >
              <span className={styles.suggestionMain}>
                {prediction.mainText?.text ?? prediction.text.text}
              </span>
              {prediction.secondaryText?.text && (
                <span className={styles.suggestionSecondary}>
                  {prediction.secondaryText.text}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

PlaceSearch.propTypes = {
  className: string,
  placeholder: string,
  onPick: func.isRequired,
  onSubmitQuery: func.isRequired,
  onQueryChange: func.isRequired
};

export { PlaceSearch };
