/**
 * Prepares cover art for ingest, in the browser.
 *
 * The owner's phone downloads the front cover from the Cover Art Archive once,
 * resizes it on a canvas to the sizes the UI renders, and computes the tiny
 * placeholder and the average colour. The server then only stores bytes. Doing
 * this here means no image library in a function bundle, no request-time image
 * transformation quota, and a small upload over cellular.
 *
 * This is the only place the browser talks to the Cover Art Archive for real
 * images, and only while adding a disc: the shelf never hotlinks it.
 */

/** Sizes stored per cover: the wall tile, and the opened-disc view. */
export const TILE_PX = 500;
export const LARGE_PX = 1200;
const PLACEHOLDER_PX = 16;
const JPEG_QUALITY = 0.84;

export interface PreparedImage {
  /** Base64 JPEG without the data-URI prefix. */
  data: string;
  width: number;
  height: number;
}

export interface PreparedArtwork {
  color: string | null;
  placeholder: string | null;
  tile: PreparedImage;
  large: PreparedImage | null;
  /** Object URL of the tile, for previewing before saving. Revoke when done. */
  previewUrl: string;
}

export class NoArtworkError extends Error {
  constructor() {
    super('This release has no cover art in the Cover Art Archive.');
    this.name = 'NoArtworkError';
  }
}

async function fetchCover(mbid: string, signal?: AbortSignal): Promise<Blob> {
  // Ask for the 1200px thumbnail first; older uploads may only have 500.
  for (const size of ['1200', '500']) {
    const response = await fetch(
      `https://coverartarchive.org/release/${encodeURIComponent(mbid)}/front-${size}`,
      signal ? { signal, mode: 'cors' } : { mode: 'cors' },
    );
    if (response.ok) return response.blob();
    // 404 is the normal "no art" answer, not a failure.
    if (response.status !== 404) {
      throw new Error(`The Cover Art Archive answered ${String(response.status)}.`);
    }
  }
  throw new NoArtworkError();
}

function canvasFor(
  width: number,
  height: number,
): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot process images.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return { canvas, context };
}

/**
 * Draws the centre square of the image at `size` px. Covers are square; a
 * phone photo of one is not, and cropping to the middle is what a person would
 * do by hand.
 */
function drawSquare(bitmap: ImageBitmap, size: number) {
  const side = Math.min(bitmap.width, bitmap.height);
  const target = Math.min(size, side);
  const { canvas, context } = canvasFor(target, target);
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    target,
    target,
  );
  return { canvas, context, size: target };
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not encode the image.'));
      },
      'image/jpeg',
      quality,
    );
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked: String.fromCharCode on a whole megabyte overflows the stack.
  for (let i = 0; i < buffer.length; i += 0x8000) {
    binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function averageColour(context: CanvasRenderingContext2D, size: number): string {
  const { data } = context.getImageData(0, 0, size, size);
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i] ?? 0;
    g += data[i + 1] ?? 0;
    b += data[i + 2] ?? 0;
  }
  const hex = (value: number) =>
    Math.round(value / pixels)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** Resizes any image blob (downloaded art or a phone photo) for ingest. */
export async function prepareImage(source: Blob): Promise<PreparedArtwork> {
  const bitmap = await createImageBitmap(source);
  try {
    const tile = drawSquare(bitmap, TILE_PX);
    const tileBlob = await toBlob(tile.canvas, JPEG_QUALITY);

    // Only store a large version when there are real pixels to show at that size.
    const side = Math.min(bitmap.width, bitmap.height);
    let large: PreparedImage | null = null;
    if (side >= TILE_PX * 1.4) {
      const big = drawSquare(bitmap, LARGE_PX);
      large = {
        data: await blobToBase64(await toBlob(big.canvas, JPEG_QUALITY)),
        width: big.size,
        height: big.size,
      };
    }

    const tiny = drawSquare(bitmap, PLACEHOLDER_PX);
    const placeholder = tiny.canvas.toDataURL('image/jpeg', 0.6);

    return {
      color: averageColour(tiny.context, tiny.size),
      placeholder,
      tile: { data: await blobToBase64(tileBlob), width: tile.size, height: tile.size },
      large,
      previewUrl: URL.createObjectURL(tileBlob),
    };
  } finally {
    bitmap.close();
  }
}

/** Downloads and prepares a release's front cover. Throws NoArtworkError on 404. */
export async function prepareCoverArt(
  mbid: string,
  signal?: AbortSignal,
): Promise<PreparedArtwork> {
  return prepareImage(await fetchCover(mbid, signal));
}

/** Small CAA thumbnail for the candidate list. Admin-only; never used on the shelf. */
export function candidateThumbnailUrl(mbid: string): string {
  return `https://coverartarchive.org/release/${encodeURIComponent(mbid)}/front-250`;
}
