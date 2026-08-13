/**
 * Minimal shape of the native Barcode Detection API. Not in lib.dom yet, and present
 * only on Android Chrome (iOS Safari falls back to ZXing).
 */
interface DetectedBarcodeLike {
  rawValue: string;
  format: string;
}

declare class BarcodeDetector {
  constructor(options?: { formats?: string[] });
  static getSupportedFormats(): Promise<string[]>;
  detect(source: CanvasImageSource): Promise<DetectedBarcodeLike[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}

/** Torch is a real capability on Android; TS's MediaTrackConstraintSet omits it. */
interface MediaTrackConstraintSet {
  torch?: boolean;
}

interface MediaTrackCapabilities {
  torch?: boolean;
}
