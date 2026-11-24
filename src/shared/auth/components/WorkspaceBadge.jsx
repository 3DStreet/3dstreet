/**
 * The plan badge beside the profile button (docs/settings.md): the active
 * workspace's plan and name ("PRO · UO Urban Design 410"), or the user's own
 * plan under Personal. The editor's right panel has its own (with a
 * tooltip); the generator uses this one.
 */
import PropTypes from 'prop-types';
import { useAuthContext } from '../../contexts';
import { workspaceLabel } from '../../utils/workspace';
import styles from './WorkspaceBadge.module.scss';

export const WorkspaceBadge = ({ onClick }) => {
  const { currentUser } = useAuthContext();
  if (!currentUser) return null;
  const label = workspaceLabel(currentUser);
  return (
    <button
      type="button"
      className={styles.badge}
      onClick={onClick}
      title={label}
    >
      {label}
    </button>
  );
};

WorkspaceBadge.propTypes = {
  onClick: PropTypes.func
};
