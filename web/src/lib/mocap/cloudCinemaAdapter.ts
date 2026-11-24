export type CloudCinemaProviderId = 'viggle' | 'runway-act-one';

export type CloudCinemaJobRequest = {
  motionUrl: string;
  audioUrl: string;
  characterImageUrl: string;
  aspectRatio?: '9:16' | '16:9';
};

export type CloudCinemaJobStatus = {
  jobId: string;
  provider: CloudCinemaProviderId;
  state: 'queued' | 'processing' | 'completed' | 'failed';
  outputVideoUrl?: string;
  error?: string;
};

/** Pluggable interface for future Pro Cloud AI Cinema rendering (Viggle AI / Runway Act-One). */
export interface ICloudCinemaProvider {
  readonly id: CloudCinemaProviderId;
  isConfigured(): boolean;
  submitJob(req: CloudCinemaJobRequest): Promise<CloudCinemaJobStatus>;
  getJobStatus(jobId: string): Promise<CloudCinemaJobStatus>;
}

export class ViggleCinemaProvider implements ICloudCinemaProvider {
  readonly id = 'viggle' as const;
  isConfigured(): boolean {
    return typeof process !== 'undefined' && Boolean(process.env.VIGGLE_API_KEY);
  }
  async submitJob(): Promise<CloudCinemaJobStatus> {
    throw new Error('Viggle Pro Cinema provider is not enabled in this environment.');
  }
  async getJobStatus(jobId: string): Promise<CloudCinemaJobStatus> {
    return { jobId, provider: this.id, state: 'failed', error: 'Viggle Pro Cinema provider is not enabled.' };
  }
}

export class RunwayActOneProvider implements ICloudCinemaProvider {
  readonly id = 'runway-act-one' as const;
  isConfigured(): boolean {
    return typeof process !== 'undefined' && Boolean(process.env.RUNWAY_API_KEY);
  }
  async submitJob(): Promise<CloudCinemaJobStatus> {
    throw new Error('Runway Act-One Pro Cinema provider is not enabled in this environment.');
  }
  async getJobStatus(jobId: string): Promise<CloudCinemaJobStatus> {
    return { jobId, provider: this.id, state: 'failed', error: 'Runway Act-One Pro Cinema provider is not enabled.' };
  }
}

export function getCloudCinemaProvider(): ICloudCinemaProvider | null {
  const selected = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_CLOUD_CINEMA_PROVIDER : undefined;
  const providers: ICloudCinemaProvider[] = [new ViggleCinemaProvider(), new RunwayActOneProvider()];
  const match = providers.find((p) => p.id === selected && p.isConfigured());
  return match ?? null;
}
