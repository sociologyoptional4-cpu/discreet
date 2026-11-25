import { createPersistentStorage, UploadQueue } from '@/lib/media/optimisticUpload';
import { processVideoOnDevice } from '@/lib/media/webcodecsEngine';
import { publishProcessedVideo, type ProcessedPostMeta } from '@/lib/publishPost';

/**
 * The app's background publisher for recorded videos: optimise on the phone (WebCodecs, with a plain-upload
 * fallback), upload to R2, insert the post. Jobs are saved in IndexedDB and resumed on the next visit.
 */
export const smartUploadQueue = new UploadQueue<ProcessedPostMeta>(
  {
    async process(video, _meta, { onProgress, signal }) {
      const result = await processVideoOnDevice(video, { onProgress, signal });
      return { video: result.videoBlob, thumbnail: result.thumbnailBlob };
    },
    publish: (job, { onProgress }) => publishProcessedVideo({ postId: job.id, video: job.video, thumbnail: job.thumbnail, meta: job.meta }, onProgress).then(() => undefined),
  },
  createPersistentStorage<ProcessedPostMeta>(),
);
