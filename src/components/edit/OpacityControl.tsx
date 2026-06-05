/**
 * Opacity control: a 0–100 slider that writes the Tailwind `opacity-N` utility at
 * the active breakpoint. Reads the effective value across the cascade so it shows
 * the inherited/overridden value at the current layer.
 */

import {
  scaleValue,
  spacingResetSpec,
  readLayer,
  type LayerContext,
  type ResetSpec,
} from '../../lib/edit';
import { ResettableLabel } from './ResettableLabel';

interface Props {
  currentClass: string;
  layer: LayerContext;
  onApplyEnum: (token: string, style: Record<string, string>) => void;
  onReset: (spec: ResetSpec) => void;
}

export function OpacityControl({ currentClass, layer, onApplyEnum, onReset }: Props) {
  const opacity = readLayer(currentClass, layer, (s) => scaleValue(s, 'opacity'));
  return (
    <div className="ss-edit-panel__control">
      <ResettableLabel
        label="Opacity"
        definedAt={opacity.definedAt}
        active={layer.bp}
        onReset={() => onReset(spacingResetSpec('opacity', 'opacity'))}
      />
      <input
        type="range"
        className="ss-edit-panel__slider"
        aria-label="Opacity"
        min={0}
        max={100}
        step={5}
        value={opacity.value ?? 100}
        onChange={(e) => {
          const n = Number(e.target.value);
          onApplyEnum(`opacity-${n}`, { opacity: String(n / 100) });
        }}
      />
    </div>
  );
}
