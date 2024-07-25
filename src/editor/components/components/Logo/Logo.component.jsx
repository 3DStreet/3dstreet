import styles from './Logo.module.scss';

/**
 * Logo component.
 *
 * @author Oleksii Medvediev
 * @category Components
 */
const Logo = () => (
  <div className={styles.wrapper}>
    <img src="ui_assets/favicon.ico" alt="3DStreet Logo" />
  </div>
);

export { Logo };
