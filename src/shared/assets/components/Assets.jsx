/**
 * Assets Component - Main container component
 */

import AssetsSidebar from './AssetsSidebar.jsx';

const Assets = ({
  mode = 'sidebar',
  onUseForGenerator,
  onUseForVideo,
  onNotification,
  onSignIn,
  onClose
}) => {
  // For now, only sidebar mode is implemented
  // Modal mode can be added later for other use cases
  if (mode === 'sidebar') {
    return (
      <AssetsSidebar
        onUseForGenerator={onUseForGenerator}
        onUseForVideo={onUseForVideo}
        onNotification={onNotification}
        onSignIn={onSignIn}
      />
    );
  }

  // Future: add modal mode support
  return null;
};

export default Assets;
