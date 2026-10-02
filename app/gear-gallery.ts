import type { IconKind } from './custom-icons';

export type GearArtwork = { id: string; name: string; src: string; kind: IconKind };

// Local assets keep selection and exports independent of third-party image hosts.
export const gearGallery: GearArtwork[] = [
  { id: 'zve10ii-white', name: 'ZV-E10 II 白色', src: 'zve10ii-camera-white-crop.png', kind: 'camera' },
  { id: 'a6700', name: 'α6700', src: 'gear/a6700.jpg', kind: 'camera' },
  { id: 'a7-iv', name: 'α7 IV', src: 'gear/a7-iv.jpg', kind: 'camera' },
  { id: 'e-16-50-ii', name: 'E PZ 16-50 II', src: 'zve10ii-lens-white.png', kind: 'lens' },
  { id: 'e-18-135', name: 'E 18-135 OSS', src: 'zve10ii-lens-18-135-black.png', kind: 'lens' },
  { id: 'e-35-f18', name: 'E 35 F1.8 OSS', src: 'gear/e-35-f18.jpg', kind: 'lens' },
  { id: 'e-18-105-f4', name: 'E PZ 18-105 F4 G', src: 'gear/e-18-105-f4.jpg', kind: 'lens' },
  { id: 'e-16-55-f28', name: 'E 16-55 F2.8 G', src: 'gear/e-16-55-f28.jpg', kind: 'lens' },
];
