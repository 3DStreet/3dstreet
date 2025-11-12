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
  const isEditor = !currentPath.includes('/generator');
  const isImageGenerator = currentPath.includes('/generator');

  const handleEditorClick = () => {
    if (isEditor) {
      return;
    }
    window.location.href = '/';
  };

  const handleImageGeneratorClick = () => {
    if (isImageGenerator) {
      return;
    }
    window.location.href = '/generator/';
  };

  return (
    <HoverCard.Root openDelay={200}>
      <DropdownMenu.Root>
        <HoverCard.Trigger asChild>
          <DropdownMenu.Trigger className={styles.trigger}>
            <img
              src="/ui_assets/3D-St-stacked-128.png"
              alt="3DStreet Logo"
              className={styles.logo}
            />
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
              onClick={handleEditorClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>3DStreet Editor</span>
                {isEditor && <span className={styles.badge}>Current</span>}
              </div>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={styles.item}
              onClick={handleImageGeneratorClick}
            >
              <div className={styles.itemContent}>
                <span className={styles.appName}>AI Image Generator</span>
                {isImageGenerator && (
                  <span className={styles.badge}>Current</span>
                )}
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
