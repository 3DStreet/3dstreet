import ReactGA from 'react-ga4';

const sendMetric = (category, action, label) => {
  ReactGA.event({
    category,
    action,
    label: label
  });
};

export { sendMetric };
