// React import removed as it's not needed with modern JSX transform
import useStore from '@/store.js';
import { PanelToggleButton } from '../../components';
// Using emoji instead of icon
import styles from './ReportButton.module.scss';

export const ReportButton = () => {
  const setModal = useStore((state) => state.setModal);
  const isOpen = useStore((state) => state.modal === 'report');

  return (
    <PanelToggleButton
      isOpen={isOpen}
      onClick={() => setModal('report')}
      className={styles.reportButton}
    >
      Generate Report 📋
    </PanelToggleButton>
  );
};
