// Analyze a small sample instead of allocating a full-resolution pixel buffer.
const brightnessCache = new WeakMap<object, number>();
export function autoColorFilter(source: CanvasImageSource, strength: number): string {
  const amount = Math.max(0, Math.min(100, strength)) / 100;
  if (!amount) return 'none';
  let mean = brightnessCache.get(source);
  if (mean === undefined) {
    const sample = document.createElement('canvas');
    sample.width = sample.height = 64;
    try {
      const ctx = sample.getContext('2d', { willReadFrequently: true });
      if (!ctx) return 'none';
      ctx.drawImage(source, 0, 0, 64, 64);
      const pixels = ctx.getImageData(0, 0, 64, 64).data;
      let sum = 0, weight = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const alpha = pixels[i + 3] / 255;
        sum += (.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]) * alpha;
        weight += alpha;
      }
      mean = weight ? sum / weight : 128;
      brightnessCache.set(source, mean);
    } finally { sample.width = sample.height = 0; }
  }
  const gain = Math.max(.9, Math.min(1.18, 128 / Math.max(1, mean)));
  return 'brightness(' + (1 + (gain - 1) * amount) + ') contrast(' + (1 + .035 * amount) + ') saturate(' + (1 + .08 * amount) + ')';
}
