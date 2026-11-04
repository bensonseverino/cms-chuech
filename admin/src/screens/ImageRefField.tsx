import { MediaFieldInput } from '../components/MediaPicker'
import { TextInput } from '../components/ui'

export function ImageRefField({
  label,
  value,
  onChange,
  disabled,
  media,
  onMedia,
}: {
  label?: string
  value?: { mediaId: string; alt?: string; focalX?: number; focalY?: number } | null
  onChange?: (value: { mediaId: string; alt?: string; focalX?: number; focalY?: number } | null) => void
  disabled?: boolean
  media?: Record<string, import('../api/types').MediaView>
  onMedia?: (chosen: import('../api/types').MediaView) => void
}) {
  const handleAltChange = (alt: string | undefined) => onChange?.({ ...value, alt } as any)
  const handleFocalChange = (focalX?: number, focalY?: number) => onChange?.({ ...value, focalX, focalY } as any)

  return (
    <div className="flex flex-col gap-3">
      {label && (
        <label className="text-sm font-semibold leading-tight text-obsidian">
          {label}
          <span className="text-obsidian/50 ml-1">*</span>
        </label>
      )}
      <MediaFieldInput
        value={value as any}
        onChange={(val) => onChange?.(val as any)}
        accept="image"
        disabled={disabled}
        media={media ?? {}}
        onMedia={onMedia as any}
      />
      <div className="flex flex-col gap-2">
        <TextInput
          label="Alt text"
          value={value?.alt ?? ''}
          onChange={(e) => handleAltChange(e.target.value || undefined)}
          placeholder="Describe the image for screen readers"
          disabled={disabled}
          maxLength={300}
        />
        <div className="flex gap-4">
          <TextInput
            label="Focus X"
            type="number"
            min={0}
            max={100}
            step={1}
            value={value?.focalX ?? 50}
            onChange={(e) => handleFocalChange(Number(e.target.value) ?? 50, value?.focalY)}
            disabled={disabled}
            hint="Horizontal focal point 0–100"
          />
          <TextInput
            label="Focus Y"
            type="number"
            min={0}
            max={100}
            step={1}
            value={value?.focalY ?? 50}
            onChange={(e) => handleFocalChange(value?.focalX, Number(e.target.value) ?? 50)}
            disabled={disabled}
            hint="Vertical focal point 0–100"
          />
        </div>
      </div>
    </div>
  )
}
