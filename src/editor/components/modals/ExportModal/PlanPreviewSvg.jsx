import PropTypes from 'prop-types';
import { ACI_TO_HEX, ACI_TO_PLOT_HEX } from '@/editor/lib/plan/planModel';

// Inline-SVG renderer for the shared plan model — the Export modal's live
// preview for the DXF and PDF formats. Draws the exact linework the exporters
// emit (same geometry pass, see planModel.js). palette 'screen' renders the
// ACI colors for a dark CAD model-space look (DXF preview); 'plot' uses the
// print palette on the white PDF page preview.

const round2 = (n) => Math.round(n * 100) / 100;

function PlanPreviewSvg({ model, className, palette = 'screen' }) {
  if (!model?.bounds) return null;
  const paletteMap = palette === 'plot' ? ACI_TO_PLOT_HEX : ACI_TO_HEX;
  const fallbackColor = palette === 'plot' ? '#000000' : '#ffffff';

  const { minX, minY, maxX, maxY } = model.bounds;
  // 5% breathing room around the drawing (min 1 unit for tiny scenes).
  const pad = Math.max(maxX - minX, maxY - minY) * 0.05 || 1;
  const width = maxX - minX + 2 * pad;
  const height = maxY - minY + 2 * pad;
  // SVG y grows downward; model y grows north — flip so north stays up,
  // matching the DXF/PDF page orientation.
  const tx = (x) => round2(x - minX + pad);
  const ty = (y) => round2(maxY - y + pad);

  const colorForLayer = new Map(
    model.layers.map((l) => [l.name, paletteMap[l.color] || fallbackColor])
  );

  return (
    <svg
      className={className}
      viewBox={`0 0 ${round2(width)} ${round2(height)}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
    >
      {model.polylines.map((polyline, i) => {
        const points = polyline.points
          .map(([x, y]) => `${tx(x)},${ty(y)}`)
          .join(' ');
        const Tag = polyline.closed ? 'polygon' : 'polyline';
        return (
          <Tag
            key={`p${i}`}
            points={points}
            fill="none"
            stroke={colorForLayer.get(polyline.layer) || fallbackColor}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {model.lines.map((line, i) => (
        <line
          key={`l${i}`}
          x1={tx(line.p1[0])}
          y1={ty(line.p1[1])}
          x2={tx(line.p2[0])}
          y2={ty(line.p2[1])}
          stroke={colorForLayer.get(line.layer) || fallbackColor}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

PlanPreviewSvg.propTypes = {
  model: PropTypes.object,
  className: PropTypes.string,
  palette: PropTypes.oneOf(['screen', 'plot'])
};

export default PlanPreviewSvg;
