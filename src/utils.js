function loadScript(url, callback) {
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = url;

  script.onload = function () {
    callback();
  };

  document.head.appendChild(script);
}

function roundCoord(num) {
  return Math.round(num * 1e7) / 1e7;
}

// Drop empty segments from a comma-separated location string, e.g.
// ", , New York, United States" → "New York, United States". Older scenes
// (and the geoid cloud function before its fix) saved strings with
// placeholder commas for missing address parts.
function formatLocationString(locationString) {
  if (!locationString) {
    return '';
  }
  return locationString
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}

export { loadScript, roundCoord, formatLocationString };
