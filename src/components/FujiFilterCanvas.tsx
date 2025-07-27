// src/components/FujiFilterCanvas.tsx

import React, { useRef, useCallback, useEffect, useState } from 'react';
import { useDropzone } from 'react-dropzone';

interface Filter {
  name: string;
  src: string;  // empty = original
}

const filters: Filter[] = [
  { name: 'Original',               src: '' },
  { name: 'XT3 → F‑Log',            src: '/luts/XT3_FLog_FGamut_to_FLog_BT.709_33grid_V.1.01.png' },
  { name: 'XT3 → WDR',              src: '/luts/XT3_FLog_FGamut_to_WDR_BT.709_33grid_V.1.01.png' },
  { name: 'XT3 → ETERNA',           src: '/luts/XT3_FLog_FGamut_to_ETERNA_BT.709_33grid_V.1.01.png' },
  { name: 'XT3 → Pro Neg Std',      src: '/luts/XT3_FLog_FGamut_to_ProNegStd_BT.709_33grid_V.1.01.png' },
  { name: 'Fuji 198×198',           src: '/luts/fuji_lut_198x198.png' },
  { name: 'RR Vintage Ten',         src: '/luts/RR_Vintage_Ten.png' },
  { name: 'RR Vintage Two',         src: '/luts/RR_Vintage_Two.png' },
  { name: 'RR Vintage Six',         src: '/luts/RR_Vintage_Six.png' },
];

const FujiFilterCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lutRef = useRef<ImageData|null>(null);
  const [currentFilter, setCurrentFilter] = useState<Filter>(filters[0]);
  const [droppedImage, setDroppedImage] = useState<HTMLImageElement|null>(null);
  const [enableBloom, setEnableBloom] = useState(true);
  const [bloomStrength, setBloomStrength] = useState(15);  // blur in px

  // Load or clear LUT when filter changes
  useEffect(() => {
    if (!currentFilter.src) {
      lutRef.current = null;
      if (droppedImage) renderWithLUT(droppedImage, enableBloom, bloomStrength);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = currentFilter.src;
    img.onload = () => {
      const off = document.createElement('canvas');
      off.width = img.width;
      off.height = img.height;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      lutRef.current = ctx.getImageData(0, 0, off.width, off.height);
      if (droppedImage) renderWithLUT(droppedImage, enableBloom, bloomStrength);
    };
  }, [currentFilter]);

  // Re-render on bloom toggle or strength change
  useEffect(() => {
    if (droppedImage) renderWithLUT(droppedImage, enableBloom, bloomStrength);
  }, [enableBloom, bloomStrength]);

  // Handle image drop
  const onDrop = useCallback((files: File[]) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = () => {
        setDroppedImage(img);
        renderWithLUT(img, enableBloom, bloomStrength);
      };
    };
    reader.readAsDataURL(files[0]);
  }, [enableBloom, bloomStrength]);

  // Core render function
  const renderWithLUT = (img: HTMLImageElement, bloom: boolean, blurPx: number) => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    canvas.width = img.width;
    canvas.height = img.height;

    // 1) draw original image
    ctx.drawImage(img, 0, 0);

    // 2) apply LUT if present
    const lut = lutRef.current;
    if (lut) {
      const src = ctx.getImageData(0, 0, img.width, img.height);
      const W = lut.width, cubeSize = 33;
      const tiles = W / cubeSize, block = cubeSize;
      const whiteRGB = 0.99, whiteLuma = 0.98, clampMax = (cubeSize - 1) / cubeSize;

      for (let i = 0; i < src.data.length; i += 4) {
        const r0 = src.data[i] / 255;
        const g0 = src.data[i+1] / 255;
        const b0 = src.data[i+2] / 255;
        const luma = 0.2126*r0 + 0.7152*g0 + 0.0722*b0;
        if ((r0 > whiteRGB && g0 > whiteRGB && b0 > whiteRGB) || luma > whiteLuma) continue;

        const r = Math.min(r0, clampMax);
        const g = Math.min(g0, clampMax);
        const b = Math.min(b0, clampMax);
        const bz = Math.floor(b * (cubeSize - 1));
        const tx = bz % tiles, ty = Math.floor(bz / tiles);
        const u = (tx + r) * block, v = (ty + g) * block;

        // bilinear sampling
        const x0 = Math.floor(u), y0 = Math.floor(v);
        const x1 = Math.min(x0 + 1, W - 1), y1 = Math.min(y0 + 1, W - 1);
        const fx = u - x0, fy = v - y0;
        const idx00 = (y0*W + x0)*4, idx10 = (y0*W + x1)*4;
        const idx01 = (y1*W + x0)*4, idx11 = (y1*W + x1)*4;
        const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

        // interpolate R, G, B
        const rf = lerp(lerp(lut.data[idx00], lut.data[idx10], fx),
                        lerp(lut.data[idx01], lut.data[idx11], fx), fy);
        const gf = lerp(lerp(lut.data[idx00+1], lut.data[idx10+1], fx),
                        lerp(lut.data[idx01+1], lut.data[idx11+1], fx), fy);
        const bf = lerp(lerp(lut.data[idx00+2], lut.data[idx10+2], fx),
                        lerp(lut.data[idx01+2], lut.data[idx11+2], fx), fy);

        src.data[i]   = rf;
        src.data[i+1] = gf;
        src.data[i+2] = bf;
      }

      ctx.putImageData(src, 0, 0);
    }

    // 3) optional Bloom
    if (bloom) {
      const srcData = ctx.getImageData(0, 0, img.width, img.height);
      const bright = ctx.createImageData(srcData);
      const threshold = 200;

      for (let i = 0; i < srcData.data.length; i += 4) {
        const lum = 0.299*srcData.data[i]
                  + 0.587*srcData.data[i+1]
                  + 0.114*srcData.data[i+2];
        if (lum > threshold) {
          bright.data[i]   = srcData.data[i];
          bright.data[i+1] = srcData.data[i+1];
          bright.data[i+2] = srcData.data[i+2];
          bright.data[i+3] = srcData.data[i+3];
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = img.width;
      tmp.height = img.height;
      const tctx = tmp.getContext('2d')!;
      tctx.putImageData(bright, 0, 0);
      // use dynamic blur
      tctx.filter = `blur(${blurPx}px)`;
      tctx.drawImage(tmp, 0, 0);

      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(tmp, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });

  return (
    <div style={{ textAlign: 'center', padding: 20 }}>
      {/* Filter buttons */}
      <div style={{ marginBottom: 12 }}>
        {filters.map(f => (
          <button
            key={f.name}
            onClick={() => setCurrentFilter(f)}
            style={{
              margin: '0 6px 6px 0',
              padding: '6px 12px',
              background: f === currentFilter ? '#333' : '#eee',
              color: f === currentFilter ? '#fff' : '#000',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            {f.name}
          </button>
        ))}
      </div>

      {/* Bloom toggle & strength */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
        <button
          onClick={() => setEnableBloom(!enableBloom)}
          style={{
            padding: '6px 12px',
            background: enableBloom ? '#444' : '#ddd',
            color: enableBloom ? '#fff' : '#000',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        >
          Bloom: {enableBloom ? 'On' : 'Off'}
        </button>
        <button
          onClick={() => setBloomStrength(bs => Math.max(0, bs - 5))}
          style={{ padding: '6px', cursor: 'pointer' }}
        >−</button>
        <span>Bloom: {bloomStrength}px</span>
        <button
          onClick={() => setBloomStrength(bs => bs + 5)}
          style={{ padding: '6px', cursor: 'pointer' }}
        >＋</button>
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        style={{
          border: '2px dashed #aaa',
          padding: 40,
          cursor: 'pointer',
          marginBottom: 20
        }}
      >
        <input {...getInputProps()} />
        {isDragActive
          ? <p>이미지를 여기로 드롭하세요</p>
          : <p>클릭 또는 드래그하여 이미지를 업로드하세요</p>}
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100%', border: '1px solid #ccc' }}
      />
    </div>
  );
};

export default FujiFilterCanvas;
