import PropTypes from 'prop-types';
import { getAssetImageSrc } from '@/lazy-textures';

// A dropdown option for a street surface: a swatch and a name. The swatch is
// the same A-Frame <img> texture asset the surface renders with, so it always
// matches what is drawn; a surface with no texture (or an asset not in the
// scene) gets a flat chip of `flatColor`. Shared by the segment Material
// dropdown and a shape's Fill material dropdown; styled by `.surface-option`
// and `.surface-swatch` in components.scss.
const SurfaceSwatchOption = ({ label, textureId, flatColor }) => {
  const textureSrc = textureId
    ? getAssetImageSrc(document.getElementById(textureId))
    : null;
  return (
    <span className="surface-option">
      {textureSrc ? (
        <img className="surface-swatch" src={textureSrc} alt="" />
      ) : (
        <span className="surface-swatch" style={{ background: flatColor }} />
      )}
      {label}
    </span>
  );
};

SurfaceSwatchOption.propTypes = {
  label: PropTypes.node,
  textureId: PropTypes.string,
  flatColor: PropTypes.string
};

export default SurfaceSwatchOption;
