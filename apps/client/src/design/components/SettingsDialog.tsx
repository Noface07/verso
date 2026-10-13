import React from 'react';
import { Dialog } from './Dialog';
import { useTheme, ACCENT_PRESETS, type AppTheme } from '../theme';
import { SegmentedControl } from './SegmentedControl';
import { Switch } from './Switch';
import { Slider } from './Slider';

export interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SettingsDialog: React.FC<SettingsDialogProps> = ({ open, onOpenChange }) => {
  const { settings, updateSettings } = useTheme();

  const themeOptions: { value: AppTheme; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Manage appearance and reader preferences"
    >
      <div className="flex flex-col gap-6 py-2">
        {/* Appearance Section */}
        <section className="flex flex-col gap-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
            Appearance
          </h3>

          {/* Theme Mode */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-1)]">Theme</span>
            <SegmentedControl
              size="sm"
              options={themeOptions}
              value={settings.theme}
              onChange={(val) => updateSettings({ theme: val })}
            />
          </div>

          {/* Accent Color */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-[var(--text-1)]">Accent color</span>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => updateSettings({ accent: 'dynamic' })}
                className={`px-3 py-1 text-xs rounded-[var(--r-sm)] border cursor-pointer transition-colors ${
                  settings.accent === 'dynamic'
                    ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] font-semibold'
                    : 'border-[var(--stroke)] text-[var(--text-2)] hover:bg-[var(--layer-2)]'
                }`}
              >
                Dynamic (Book)
              </button>

              {Object.entries(ACCENT_PRESETS).map(([name, hex]) => (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  onClick={() => updateSettings({ accent: name })}
                  className={`w-6 h-6 rounded-full cursor-pointer transition-transform hover:scale-110 flex items-center justify-center ${
                    settings.accent === name ? 'ring-2 ring-[var(--text-1)] ring-offset-2 ring-offset-[var(--layer-solid)]' : ''
                  }`}
                  style={{ backgroundColor: hex }}
                />
              ))}
            </div>
          </div>

          {/* Ambient Background */}
          <div className="flex flex-col gap-3 pt-2 border-t border-[var(--stroke)]">
            <Switch
              label="Ambient backdrop glow"
              checked={settings.ambientEnabled}
              onCheckedChange={(checked) => updateSettings({ ambientEnabled: checked })}
            />

            {settings.ambientEnabled && (
              <div className="flex items-center gap-4 pl-1">
                <span className="text-xs text-[var(--text-2)] min-w-[50px]">
                  {settings.ambientStrength}%
                </span>
                <Slider
                  value={[settings.ambientStrength]}
                  min={10}
                  max={60}
                  step={2}
                  onValueChange={([val]) => updateSettings({ ambientStrength: val })}
                />
              </div>
            )}
          </div>

          {/* Cover Glow */}
          <div className="pt-2 border-t border-[var(--stroke)]">
            <Switch
              label="Cover hover glow"
              checked={settings.coverGlow}
              onCheckedChange={(checked) => updateSettings({ coverGlow: checked })}
            />
          </div>
        </section>
      </div>
    </Dialog>
  );
};
