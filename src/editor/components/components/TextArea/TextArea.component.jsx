// React import removed as it's not needed with modern JSX transform
import styles from './TextArea.module.scss';
import classNames from 'classnames';

export const TextArea = ({
  id,
  name,
  value,
  onChange,
  placeholder,
  rows = 3,
  disabled = false,
  className,
  ...props
}) => {
  return (
    <textarea
      id={id}
      name={name}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled}
      className={classNames(styles.textArea, className)}
      {...props}
    />
  );
};
