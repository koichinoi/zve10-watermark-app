export const presetStorageKey = 'zve10-watermark-presets-v1';

export type PresetSettings = {
  theme: 'light' | 'dark';
  detailMode: 'full' | 'compact';
  exportFormat: 'jpeg' | 'png';
  layoutMode: 'auto' | 'landscape';
  watermarkHeight: number;
  signature: string;
  accentColor: string;
  lensImageEnabled: boolean;
  holidayId: string;
  parameterVisibility: Record<string, boolean>;
  preserveExif: boolean;
  removeGps: boolean;
};
export type WatermarkPreset = { name: string; settings: PresetSettings };

export function readPresets(value: string | null, parameterKeys: string[], holidayIds: string[]): WatermarkPreset[] {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    const names = new Set<string>();
    return parsed.filter((preset) => {
      if (!preset || typeof preset.name !== 'string' || !preset.name.trim() || preset.name.length > 40 || names.has(preset.name)) return false;
      const s = preset.settings;
      if (!s || !['light', 'dark'].includes(s.theme) || !['full', 'compact'].includes(s.detailMode)
        || !['jpeg', 'png'].includes(s.exportFormat) || !['auto', 'landscape'].includes(s.layoutMode)
        || !Number.isFinite(s.watermarkHeight) || s.watermarkHeight < 8 || s.watermarkHeight > 22
        || typeof s.signature !== 'string' || s.signature.length > 36
        || typeof s.accentColor !== 'string' || !/^#[\da-f]{6}$/i.test(s.accentColor)
        || typeof s.lensImageEnabled !== 'boolean' || !holidayIds.includes(s.holidayId)
        || typeof s.preserveExif !== 'boolean' || typeof s.removeGps !== 'boolean'
        || !s.parameterVisibility || !parameterKeys.every((key) => typeof s.parameterVisibility[key] === 'boolean')) return false;
      names.add(preset.name);
      return true;
    }).slice(0, 20).map(({ name, settings }) => ({
      name,
      // Explicit whitelist: photos, metadata, GPS and rotations are not presets.
      settings: {
        theme: settings.theme, detailMode: settings.detailMode, exportFormat: settings.exportFormat,
        layoutMode: settings.layoutMode, watermarkHeight: settings.watermarkHeight,
        signature: settings.signature, accentColor: settings.accentColor,
        lensImageEnabled: settings.lensImageEnabled, holidayId: settings.holidayId,
        preserveExif: settings.preserveExif, removeGps: settings.removeGps,
        parameterVisibility: Object.fromEntries(parameterKeys.map((key) => [key, settings.parameterVisibility[key]])),
      },
    }));
  } catch {
    return [];
  }
}

