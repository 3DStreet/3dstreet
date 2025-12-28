import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as HoverCard from '@radix-ui/react-hover-card';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import styles from './AppSwitcher.module.scss';

// Placemark logo SVG component
const PlacemarkLogo = ({ size = 32, className = '' }) => (
  <svg
    viewBox="0 0 300 300"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    className={className}
  >
    <circle cx="75" cy="75" r="17.5" stroke="currentColor" strokeWidth="15" />
    <circle cx="225" cy="225" r="17.5" stroke="currentColor" strokeWidth="15" />
    <circle cx="225" cy="75" r="17.5" stroke="currentColor" strokeWidth="15" />
    <circle cx="75" cy="225" r="17.5" stroke="currentColor" strokeWidth="15" />
    <line
      x1="75"
      y1="95"
      x2="75"
      y2="208"
      stroke="currentColor"
      strokeWidth="20"
    />
    <line
      x1="226"
      y1="95"
      x2="226"
      y2="208"
      stroke="currentColor"
      strokeWidth="20"
    />
    <line
      x1="95"
      y1="75"
      x2="208"
      y2="75"
      stroke="currentColor"
      strokeWidth="20"
    />
    <line
      x1="95"
      y1="225"
      x2="208"
      y2="225"
      stroke="currentColor"
      strokeWidth="20"
    />
    <rect x="110" y="110" width="80" height="80" rx="5" fill="currentColor" />
  </svg>
);

// Simple inline icon renderer - works in both editor and generator
const AwesomeIconSimple = ({ icon, size = 12, className = '' }) => {
  const width = icon.icon[0];
  const height = icon.icon[1];
  const vectorData = icon.icon[4];

  return (
    <svg
      role="img"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${width} ${height}`}
      width={size}
      height={size}
      style={{ display: 'inline-block' }}
    >
      <path fill="currentColor" d={vectorData} />
    </svg>
  );
};

const AppSwitcher = ({ currentApp = null }) => {
  // If currentApp prop is provided, use it directly
  // Otherwise, detect from pathname and hostname
  let isBollardBuddy, isImageGenerator, isPlacemark, isEditor;

  if (currentApp) {
    isBollardBuddy = currentApp === 'bollardbuddy';
    isImageGenerator = currentApp === 'generator';
    isPlacemark = currentApp === 'placemark';
    isEditor = currentApp === 'editor';
  } else {
    const currentPath = window.location.pathname;
    const currentHost = window.location.hostname;
    isBollardBuddy = currentPath.includes('/bollardbuddy');
    isImageGenerator = currentPath.includes('/generator');
    isPlacemark = currentHost.includes('placemark.');
    isEditor = !isImageGenerator && !isBollardBuddy && !isPlacemark;
  }

  // Determine which logo to show based on current app
  let currentLogo = '/ui_assets/3D-St-stacked-128.png';
  let currentAlt = '3DStreet Logo';
  if (isBollardBuddy) {
    currentLogo = '/ui_assets/logo-bollard-buddy-text-rect.png';
    currentAlt = 'Bollard Buddy Logo';
  }
  // Placemark uses inline SVG logo (handled separately in render)

  const handleEditorClick = (e) => {
    if (isEditor) {
      return;
    }
    // Command+click (Mac) or Ctrl+click (Windows/Linux) opens in new tab
    if (e.metaKey || e.ctrlKey) {
      window.open('/', '_blank');
    } else {
      window.location.href = '/';
    }
  };

  const handleImageGeneratorClick = (e) => {
    if (isImageGenerator) {
      return;
    }
    // Command+click (Mac) or Ctrl+click (Windows/Linux) opens in new tab
    if (e.metaKey || e.ctrlKey) {
      window.open('/generator/', '_blank');
    } else {
      window.location.href = '/generator/';
    }
  };

  const handleBollardBuddyClick = (e) => {
    if (isBollardBuddy) {
      return;
    }
    // Command+click (Mac) or Ctrl+click (Windows/Linux) opens in new tab
    if (e.metaKey || e.ctrlKey) {
      window.open('/bollardbuddy/', '_blank');
    } else {
      window.location.href = '/bollardbuddy/';
    }
  };

  const handlePlacemarkClick = (e) => {
    if (isPlacemark) {
      return;
    }
    const placemarkUrl = 'https://placemark.3dstreet.app';
    // Command+click (Mac) or Ctrl+click (Windows/Linux) opens in new tab
    if (e.metaKey || e.ctrlKey) {
      window.open(placemarkUrl, '_blank');
    } else {
      window.location.href = placemarkUrl;
    }
  };

  return (
    <HoverCard.Root openDelay={200}>
      <DropdownMenu.Root>
        <HoverCard.Trigger asChild>
          <DropdownMenu.Trigger className={styles.trigger}>
            {isPlacemark ? (
              <PlacemarkLogo size={32} className={styles.logo} />
            ) : (
              <img src={currentLogo} alt={currentAlt} className={styles.logo} />
            )}
            <AwesomeIconSimple
              icon={faChevronDown}
              size={12}
              className={styles.arrow}
            />
          </DropdownMenu.Trigger>
        </HoverCard.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={styles.content}
            align="start"
            sideOffset={5}
          >
            <DropdownMenu.Label className={styles.label}>
              Switch Apps
            </DropdownMenu.Label>
            <DropdownMenu.Separator className={styles.separator} />
            <DropdownMenu.Item
              className={styles.item}
              onClick={handleBollardBuddyClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>Bollard Buddy Web</span>
                {isBollardBuddy && (
                  <span className={styles.badge}>Current</span>
                )}
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={styles.item}
              onClick={handleEditorClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>Editor</span>
                {isEditor && <span className={styles.badge}>Current</span>}
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={styles.item}
              onClick={handleImageGeneratorClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>AI Generator</span>
                {isImageGenerator && (
                  <span className={styles.badge}>Current</span>
                )}
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={styles.item}
              onClick={handlePlacemarkClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>Placemark Play</span>
                {isPlacemark && <span className={styles.badge}>Current</span>}
              </div>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <HoverCard.Portal>
        <HoverCard.Content
          side="bottom"
          align="start"
          sideOffset={5}
          style={{
            backgroundColor: '#2d2d2d',
            color: 'white',
            padding: '6px 12px',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '500',
            zIndex: 10000,
            maxWidth: '200px'
          }}
        >
          App Switcher
          <HoverCard.Arrow style={{ fill: '#2d2d2d' }} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
};

export default AppSwitcher;
