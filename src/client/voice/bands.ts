// Speech spectrum, mirrored clockwise from the top around a 32-bar circle.
// At coarse FFT resolution some log bands contain no bin center; use the
// nearest bin to the band's midpoint. Boundaries use the actual context rate.
export function toBands(bytes: Uint8Array, sampleRate: number, fftSize: number,
  count = 16, out: Float32Array = new Float32Array(count * 2)): Float32Array {
  const binHz = sampleRate / fftSize;
  for (let band = 0; band < count; band++) {
    const low = 100 * 40 ** (band / count);
    const high = 100 * 40 ** ((band + 1) / count);
    const first = Math.ceil(low / binHz), boundary = Math.ceil(high / binHz);
    const start = Math.min(bytes.length - 1, boundary > first ? first : Math.round((low + high) / (2 * binHz)));
    const end = Math.min(bytes.length, Math.max(start + 1, boundary));
    let sum = 0;
    for (let bin = start; bin < end; bin++) sum += bytes[bin];
    const value = sum / ((end - start) * 255);
    // SVG angles start at 3 o'clock; the lowest pair sits at the top.
    out[(count * 1.5 + band) % (count * 2)] = value;
    out[(count * 1.5 - 1 - band + count * 2) % (count * 2)] = value;
  }
  return out;
}
