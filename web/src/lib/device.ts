/**
 * Every iOS browser is WebKit underneath, and iOS Safari either lacks `ctx.filter` or runs it slowly,
 * so on iOS the Blur mode uses the cheap pixel mosaic instead of a canvas blur.
 */
export function isIosWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  const iPhoneOrPod = /iP(hone|od)/.test(navigator.userAgent);
  // iPadOS reports itself as a Mac but has a touch screen.
  const iPad = /iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iPhoneOrPod || iPad;
}

export const shouldUsePixelFallback = (): boolean => isIosWebKit();
