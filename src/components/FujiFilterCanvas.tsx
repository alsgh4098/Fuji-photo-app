// src/components/FujiFilterCanvas.tsx

import React, { useRef, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';

const FujiFilterCanvas: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lutRef = useRef<ImageData | null>(null);

  // 1) 33³ 그리드 LUT(198×198) 로드
  useEffect(() => {
    const lutImg = new Image();
    lutImg.crossOrigin = 'anonymous';
    lutImg.src = '/luts/fuji_lut_198x198.png';
    lutImg.onload = () => {
      const off = document.createElement('canvas');
      off.width = lutImg.width;
      off.height = lutImg.height;
      const ctx = off.getContext('2d')!;
      ctx.drawImage(lutImg, 0, 0);
      lutRef.current = ctx.getImageData(0, 0, off.width, off.height);
      console.log(`LUT loaded: ${off.width}×${off.height}`);
    };
  }, []);

  const onDrop = useCallback((files: File[]) => {
    if (!lutRef.current) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result as string;
      img.onload = () => {
        // 원본 캔버스에 그리기
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext('2d')!;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        // Fuji LUT 매핑 (이전 코드 그대로)
        const src = ctx.getImageData(0, 0, img.width, img.height);
        const lut = lutRef.current!;
        const W = lut.width;   // 198
        const cubeSize = 33;
        const tilesX = W / cubeSize; // 6
        const block = cubeSize;

        const whiteThreshRGB = 0.99;
        const whiteThreshLuma = 0.98;
        const clampMax = (cubeSize - 1) / cubeSize;

        for (let i = 0; i < src.data.length; i += 4) {
          const r0 = src.data[i]     / 255;
          const g0 = src.data[i + 1] / 255;
          const b0 = src.data[i + 2] / 255;
          const luma = 0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0;

          if (
            (r0 > whiteThreshRGB && g0 > whiteThreshRGB && b0 > whiteThreshRGB)
            || luma > whiteThreshLuma
          ) continue;

          const r = Math.min(r0, clampMax);
          const g = Math.min(g0, clampMax);
          const b = Math.min(b0, clampMax);

          const bz = Math.floor(b * (cubeSize - 1));
          const tx = bz % tilesX;
          const ty = Math.floor(bz / tilesX);

          const u = (tx + r) * block;
          const v = (ty + g) * block;

          const x0 = Math.floor(u);
          const y0 = Math.floor(v);
          const x1 = Math.min(x0 + 1, W - 1);
          const y1 = Math.min(y0 + 1, W - 1);
          const fx = u - x0;
          const fy = v - y0;

          const idx00 = (y0 * W + x0) * 4;
          const idx10 = (y0 * W + x1) * 4;
          const idx01 = (y1 * W + x0) * 4;
          const idx11 = (y1 * W + x1) * 4;

          const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

          const r00 = lut.data[idx00],     r10 = lut.data[idx10];
          const r01 = lut.data[idx01],     r11 = lut.data[idx11];
          const r0_ = lerp(r00, r10, fx),  r1_ = lerp(r01, r11, fx);
          const rf  = lerp(r0_, r1_, fy);

          const g00 = lut.data[idx00+1],   g10 = lut.data[idx10+1];
          const g01 = lut.data[idx01+1],   g11 = lut.data[idx11+1];
          const g0_ = lerp(g00, g10, fx),  g1_ = lerp(g01, g11, fx);
          const gf  = lerp(g0_, g1_, fy);

          const b00 = lut.data[idx00+2],   b10 = lut.data[idx10+2];
          const b01 = lut.data[idx01+2],   b11 = lut.data[idx11+2];
          const b0_ = lerp(b00, b10, fx),  b1_ = lerp(b01, b11, fx);
          const bf  = lerp(b0_, b1_, fy);

          src.data[i    ] = rf;
          src.data[i + 1] = gf;
          src.data[i + 2] = bf;
        }

        // 1) 먼저 LUT 결과 그리기
        ctx.putImageData(src, 0, 0);

        // ──────────────────────────────────────
        // 2) Bloom 후처리
        // ──────────────────────────────────────

        // A) brightness pass: threshold 이상의 픽셀만 복사
        const brightPass = ctx.createImageData(src);
        const threshold = 200; // 0–255, 조절 가능
        for (let i = 0; i < src.data.length; i += 4) {
          const lum = 0.299 * src.data[i]
                    + 0.587 * src.data[i + 1]
                    + 0.114 * src.data[i + 2];
          if (lum > threshold) {
            brightPass.data[i    ] = src.data[i    ];
            brightPass.data[i + 1] = src.data[i + 1];
            brightPass.data[i + 2] = src.data[i + 2];
            brightPass.data[i + 3] = src.data[i + 3];
          }
        }

        // B) 임시 캔버스에 그린 뒤 블러 적용
        const tmp = document.createElement('canvas');
        tmp.width = canvas.width;
        tmp.height = canvas.height;
        const tctx = tmp.getContext('2d')!;
        tctx.putImageData(brightPass, 0, 0);
        tctx.filter = 'blur(15px)';        // blur 강도 조절
        tctx.drawImage(tmp, 0, 0);

        // C) 원본 캔버스에 additive 합성
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(tmp, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      };
    };
    reader.readAsDataURL(files[0]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop });
  return (
    <div style={{ textAlign: 'center', padding: 20 }}>
      <div
        {...getRootProps()}
        style={{
          border: '2px dashed #aaa',
          padding: 50,
          cursor: 'pointer',
          marginBottom: 20,
        }}
      >
        <input {...getInputProps()} />
        {isDragActive
          ? <p>이미지를 드롭하세요</p>
          : <p>클릭 또는 드래그로 이미지를 업로드하세요</p>}
      </div>
      <canvas
        ref={canvasRef}
        style={{ marginTop: 20, maxWidth: '100%', border: '1px solid #ccc' }}
      />
    </div>
  );
};

export default FujiFilterCanvas;
