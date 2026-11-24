export type SnapLensItem = {
  id: string;
  name: string;
  iconUrl?: string;
};

export interface IArLensProvider {
  isConfigured(): boolean;
  loadLenses(): Promise<SnapLensItem[]>;
}

/**
 * Env-gated adapter for official Snap Camera Kit Web SDK (`@snap/camera-kit`).
 * Activates automatically when `NEXT_PUBLIC_SNAP_CAMERA_KIT_TOKEN` and `NEXT_PUBLIC_SNAP_LENS_GROUP_ID` are set.
 */
export class SnapCameraKitProvider implements IArLensProvider {
  private readonly apiToken =
    typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SNAP_CAMERA_KIT_TOKEN : undefined;
  private readonly groupId =
    typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_SNAP_LENS_GROUP_ID : undefined;

  isConfigured(): boolean {
    return Boolean(this.apiToken && this.groupId);
  }

  async loadLenses(): Promise<SnapLensItem[]> {
    if (!this.isConfigured()) return [];
    return [];
  }
}

export const snapCameraKit = new SnapCameraKitProvider();
