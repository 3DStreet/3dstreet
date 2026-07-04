import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as HoverCard from '@radix-ui/react-hover-card';
import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
import styles from './AppSwitcher.module.scss';

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

const AppSwitcher = () => {
  // Detect current app from pathname
  const currentPath = window.location.pathname;
  const isBollardBuddy = currentPath.includes('/bollardbuddy');
  const isImageGenerator = currentPath.includes('/generator');
  const isEditor = !isImageGenerator && !isBollardBuddy;

  // Determine which logo to show based on current app
  const currentLogo = isBollardBuddy
    ? '/ui_assets/logo-bollard-buddy-text-rect.png'
    : '/ui_assets/3D-St-stacked-128.png';
  const currentAlt = isBollardBuddy ? 'Bollard Buddy Logo' : '3DStreet Logo';

  // Name + one-line blurb for whichever app is currently open. The dropdown
  // header reiterates the active app, so it just shows the name (no "About").
  const currentAppName = isBollardBuddy
    ? 'Bollard Buddy Web'
    : isImageGenerator
      ? 'AI Generator'
      : '3DStreet Editor';
  const currentAppAbout = isBollardBuddy
    ? 'Place virtual bollards in AR and save photos to your 3DStreet gallery. The web version is in beta; the native iOS app has the best experience.'
    : isImageGenerator
      ? 'Generate images and videos of your street scenes with AI, from text prompts or reference photos.'
      : 'Design 3D street scenes in your browser, then output AI renderings, video, and shareable visualizations.';

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

  const handleBollardBuddyIOSClick = () => {
    window.open('https://www.3dstreet.com/bollardbuddy/', '_blank');
  };

  return (
    <HoverCard.Root openDelay={200}>
      <DropdownMenu.Root>
        <HoverCard.Trigger asChild>
          <DropdownMenu.Trigger className={styles.trigger}>
            <img src={currentLogo} alt={currentAlt} className={styles.logo} />
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
              {currentAppName}
            </DropdownMenu.Label>
            <div className={styles.about}>{currentAppAbout}</div>
            <DropdownMenu.Separator className={styles.separator} />
            <DropdownMenu.Label className={styles.label}>
              Switch Apps
            </DropdownMenu.Label>
            <DropdownMenu.Item
              className={isEditor ? styles.itemActive : styles.item}
              onClick={handleEditorClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>3DStreet Editor</span>
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={isImageGenerator ? styles.itemActive : styles.item}
              onClick={handleImageGeneratorClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>AI Generator</span>
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={isBollardBuddy ? styles.itemActive : styles.item}
              onClick={handleBollardBuddyClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>Bollard Buddy Web</span>
                {!isBollardBuddy && (
                  <span className={styles.badgeMuted}>Beta</span>
                )}
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={styles.item}
              onClick={handleBollardBuddyIOSClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>Bollard Buddy iOS</span>
                <span className={styles.badge}>Get the App</span>
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
