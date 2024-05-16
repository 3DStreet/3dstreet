import styles from './SavingModal.module.scss';

import { Component } from 'react';

/**
 * SavingModal component.
 *
 * @author Oleksii Medvediev
 * @category Components
 */
class SavingModal extends Component {
  render() {
    return (
      <div className={styles.savingModalWrapper}>
        <div className={styles.preloaderBox}>
          <svg
            className={styles.preloader}
            width="60"
            height="60"
            viewBox="0 0 60 60"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g clipPath="url(#clip0_2302_26913)">
              <path
                d="M45.91 14.0902L42.375 17.6252C39.5123 14.7622 35.7454 12.9804 31.7162 12.5833C27.6871 12.1863 23.6448 13.1986 20.2783 15.4477C16.9118 17.6968 14.4294 21.0437 13.2538 24.918C12.0783 28.7923 12.2826 32.9543 13.8317 36.6949C15.3808 40.4355 18.1791 43.5233 21.7496 45.4321C25.3201 47.3408 29.442 47.9525 33.4129 47.1629C37.3839 46.3733 40.9582 44.2313 43.5269 41.1018C46.0956 37.9723 47.4997 34.0489 47.5 30.0002H52.5C52.5 35.2057 50.695 40.2502 47.3926 44.274C44.0903 48.2979 39.4948 51.0522 34.3894 52.0677C29.2839 53.0832 23.9842 52.2971 19.3934 49.8432C14.8026 47.3893 11.2047 43.4195 9.21265 38.6103C7.22063 33.801 6.95778 28.4498 8.46889 23.4685C9.98 18.4871 13.1716 14.1839 17.4998 11.2919C21.828 8.3999 27.0251 7.09813 32.2055 7.60839C37.386 8.11865 42.2292 10.4094 45.91 14.0902Z"
                fill="white"
              />
            </g>
            <defs>
              <clipPath id="clip0_2302_26913">
                <rect width="60" height="60" fill="white" />
              </clipPath>
            </defs>
          </svg>
        </div>
        <span className={styles.action}>Saving ...</span>
      </div>
    );
  }
}

export { SavingModal };
