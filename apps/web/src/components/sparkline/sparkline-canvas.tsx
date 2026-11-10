'use client';

import { useEffect, useRef } from 'react';

export interface SparklineCanvasProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export function SparklineCanvas({
  data,
  width = 100,
  height = 28,
  color = '#16c784',
}: SparklineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    if (data.length < 2) return;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const val of data) {
      if (val < min) min = val;
      if (val > max) max = val;
    }

    const range = max - min || 1;
    const padding = 2;
    const drawHeight = height - padding * 2;
    const step = width / (data.length - 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    for (let i = 0; i < data.length; i += 1) {
      const x = i * step;
      const normalizedY = (data[i]! - min) / range;
      const y = height - padding - normalizedY * drawHeight;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  }, [data, width, height, color]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: `${width}px`,
        height: `${height}px`,
        display: 'block',
      }}
    />
  );
}
