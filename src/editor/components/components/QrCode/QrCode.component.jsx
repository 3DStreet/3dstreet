import { useMemo } from 'react';
import qrcodegen from '../../../../lib/qrcodegen';
import { saveBlob } from '../../../lib/utils';

// interface QRCODE {
//   size: number;
//   getModule(x: number, y: number): boolean;
// }

// copied from https://github.com/nayuki/QR-Code-generator/blob/2643e824eb15064662e6c4d99b010740275a0be1/typescript-javascript/qrcodegen-input-demo.ts#L171
// modified to remove doctype and add width and height
// export function toSvgString(qr: QRCODE, border: number, lightColor: string, darkColor: string) {
export function toSvgString(qr, border, lightColor, darkColor) {
  if (border < 0) throw new RangeError('Border must be non-negative');
  const parts = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        parts.push(`M${x + border},${y + border}h1v1h-1z`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 ${qr.size + border * 2} ${
    qr.size + border * 2
  }" stroke="none" width="200" height="200">
<rect width="100%" height="100%" fill="${lightColor}"/>
<path d="${parts.join(' ')}" fill="${darkColor}"/>
</svg>
`;
}

export function generateQrCodeSVG(url, border = 4) {
  const qr = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM);
  const svg = toSvgString(qr, border, '#FFFFFF', '#000000');
  return svg;
}

export function convertSVGToJPEGBlobAndDownload(svgString) {
  // Create a new image element
  const img = new Image();

  // default is 200px, not big enough for print
  svgString = svgString.replace(
    'width="200" height="200"',
    'width="600" height="600"'
  );
  // Prepare SVG blob
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);

  img.onload = function () {
    // Create a temporary canvas
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size
    canvas.width = img.width;
    canvas.height = img.height;

    // Draw the image on canvas
    ctx.drawImage(img, 0, 0);

    // Convert to JPEG and download
    canvas.toBlob(
      (blob) => {
        saveBlob(blob, 'qrcode.jpg');
      },
      'image/jpeg',
      0.8
    );

    // Clean up by revoking the created URL
    URL.revokeObjectURL(url);
  };

  // Handle errors
  img.onerror = function () {
    console.error('Error loading SVG image.');
  };

  img.src = url;
}

// interface Props {
//   url: string;
//   border?: number;
// }

export const QrCode = (props) => {
  const svgString = useMemo(() => {
    const svg = generateQrCodeSVG(props.url, props.border);
    return { __html: svg };
  }, [props.url, props.border]);

  return (
    <div
      title="Download QR Code"
      style={{ cursor: 'pointer' }}
      dangerouslySetInnerHTML={svgString}
      onClick={() => {
        // saveString(svgString.__html, 'qrcode.svg', 'image/svg+xml');
        convertSVGToJPEGBlobAndDownload(svgString.__html);
      }}
    ></div>
  );
};
