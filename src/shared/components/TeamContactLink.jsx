import PropTypes from 'prop-types';
import { useSharedMessages } from '@shared/i18n/sharedMessages';
import { captureTeamContact, teamContactHref } from '@shared/utils/teamContact';

/** "Need this for a team? Contact us": an email, until teams are self-service. */
export const TeamContactLink = ({ source, className }) => {
  const t = useSharedMessages();
  return (
    <p className={className}>
      {t('teamContactQuestion')}{' '}
      <a
        href={teamContactHref()}
        style={{ color: 'inherit', textDecoration: 'underline' }}
        onClick={() => captureTeamContact(source)}
      >
        {t('teamContactAction')}
      </a>
    </p>
  );
};

TeamContactLink.propTypes = {
  source: PropTypes.string.isRequired,
  className: PropTypes.string
};
