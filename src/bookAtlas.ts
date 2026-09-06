export type BookAtlasLayout = {
  width: number;
  height: number;
  columns: number;
  rows: number;
};

const MAX_ATLAS_WIDTH = 2048;
const MAX_ATLAS_HEIGHT = 4096;
const TARGET_TILE_WIDTH = 64;
const TARGET_TILE_HEIGHT = 384;
const MIN_ATLAS_WIDTH = 128;
const MIN_ATLAS_HEIGHT = 512;
const DIMENSION_STEP = 64;

export function bookAtlasLayout(bookCount: number, maxTextureSize: number): BookAtlasLayout {
  const count = Math.max(1, Math.floor(bookCount));
  const textureLimit = Math.max(DIMENSION_STEP, Math.floor(maxTextureSize));
  const maxWidth = Math.min(MAX_ATLAS_WIDTH, textureLimit);
  const maxHeight = Math.min(MAX_ATLAS_HEIGHT, textureLimit);
  const targetSpineAspect = TARGET_TILE_WIDTH / TARGET_TILE_HEIGHT;
  const atlasAspect = maxWidth / maxHeight;
  const columns = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * atlasAspect / targetSpineAspect))));
  const rows = Math.max(1, Math.ceil(count / columns));
  return {
    width: Math.min(maxWidth, roundDimension(Math.max(MIN_ATLAS_WIDTH, columns * TARGET_TILE_WIDTH))),
    height: Math.min(maxHeight, roundDimension(Math.max(MIN_ATLAS_HEIGHT, rows * TARGET_TILE_HEIGHT))),
    columns,
    rows
  };
}

function roundDimension(value: number) {
  return Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP;
}
