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

export { loadScript, roundCoord };
