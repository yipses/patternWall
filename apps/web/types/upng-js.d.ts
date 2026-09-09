declare module 'upng-js' {
  /**
   * Minimal surface of UPNG.js, which ships no types. `cnum` is the palette
   * size: 0 means lossless PNG-24/32, anything else quantises to that many
   * colours and writes a PNG-8.
   */
  export function encode(
    imgs: ArrayBuffer[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[],
  ): ArrayBuffer;
  const UPNG: { encode: typeof encode };
  export default UPNG;
}
