import { IntroEditor, type IntroEditorInput } from '../lib/images-tip'

type Props = IntroEditorInput & {
  label?: string
}

export function IntroEditorField({ content, onChange, disabled, label }: Props) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label className="text-sm font-semibold leading-tight text-obsidian">
          {label}
        </label>
      )}
      <IntroEditor
        content={content}
        onChange={onChange}
        disabled={disabled}
      />
    </div>
  )
}
