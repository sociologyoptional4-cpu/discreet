/** Stop each owned track once, including tracks shared by audio/video stream wrappers. */
export function stopCameraStreams(...streams: (MediaStream | null | undefined)[]) {
  const tracks = new Set(streams.flatMap(s => s?.getTracks() ?? []));
  for (const track of tracks) track.stop();
}
