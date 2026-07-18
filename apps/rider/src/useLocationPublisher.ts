import { useEffect } from 'react';
import type { LatLng, OrderStatus } from '@ebd/shared';
import { startPublishingLocation } from '@ebd/supabase';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { supabase } from './lib/supabase.ts';

/**
 * One-shot current position. Uses the Capacitor Geolocation plugin on a native
 * build (Android/iOS) and the browser API on the web. On native, background
 * updates require the ACCESS_BACKGROUND_LOCATION permission (declared in the
 * Android manifest) plus a foreground service for app-closed tracking.
 */
async function currentPosition(): Promise<LatLng> {
  if (Capacitor.isNativePlatform()) {
    const perm = await Geolocation.checkPermissions();
    if (perm.location !== 'granted') await Geolocation.requestPermissions();
    const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  }
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no geolocation'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 8000 },
    );
  });
}

/**
 * Share the rider's GPS on a per-order channel while the delivery is in transit
 * (picked_up / on_the_way). Auto-starts on pickup and stops on delivery or
 * unmount, so location is never shared while idle — saving battery and data.
 * Only active in live mode (Supabase configured); a no-op in preview.
 */
export function useLocationPublisher(orderId: string, status: OrderStatus) {
  const inTransit = status === 'picked_up' || status === 'on_the_way';
  useEffect(() => {
    if (!supabase || !inTransit) return;
    const stop = startPublishingLocation(supabase, orderId, currentPosition);
    return stop;
  }, [orderId, inTransit]);
}
