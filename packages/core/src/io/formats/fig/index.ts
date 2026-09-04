export { readFigFile, parseFigFile, type ParseFigFileOptions } from './read'
export { exportFigFile, exportFigDocument, compressFigData, compressFigDataSync } from './write'
export type { FigExportOptions, FigExportResult } from './write'
export { findFigThumbnailPageId } from './thumbnail-page'
// Lets an embedder supply image bytes from somewhere other than the
// .fig the graph came from — content-addressed server storage, in
// particular, where the archive deliberately carries no images at all.
export {
  registerImagesRequest,
  requestMissingImages
} from '#core/kiwi/fig/population/client'
export { collectImageHashes } from '#core/kiwi/fig/image-refs'
