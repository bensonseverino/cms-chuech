import { useMemo } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import { Mark, mergeAttributes } from '@tiptap/core'
import { Button } from '../components/ui'
import { Bold, Italic, Link2, Highlighter, Undo2, Redo2 } from 'lucide-react'

/* The intro statement editor (cms-projects-spec.md §4, §7.2, §3).

Only paragraph, hard break, bold, italic, link and a custom Highlight mark
survive. The toolbar renders a lavender highlight button so the owner sees the
same style the live site renders. Saved value is Tiptap HTML; the admin API
sanitises it on write with the allow-list from `@marino/content-schema`.

NOTE: Tiptap 3's `useEditor` returns `Editor | null` directly (not `{ editor }`).
*/

export type IntroEditorInput = {
  content: string
  onChange?: (html: string) => void
  disabled?: boolean
  readOnly?: boolean
}

/* Custom highlight mark. Stored as <mark data-highlight>…</mark> so the live
site can target it with a single CSS rule and the server-side sanitizer can
allow-list it explicitly. */
const HighlightExtension = Mark.create({
  name: 'highlight',
  inclusive: false,
  parseHTML() {
    return [{ tag: 'mark[data-highlight]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(HTMLAttributes, { 'data-highlight': '' }), 0]
  },
})

export function IntroEditor({
  content = '',
  onChange,
  disabled = false,
  readOnly = false,
}: IntroEditorInput) {
  const editor = useEditor({
    extensions: useMemo(
      () => [
        StarterKit.configure({
          heading: false,
          codeBlock: false,
          blockquote: false,
          horizontalRule: false,
          listItem: false,
          bulletList: false,
          orderedList: false,
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { rel: 'noopener noreferrer' },
        }),
        HighlightExtension,
      ],
      [],
    ),
    content,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate({ editor: e }) {
      if (!disabled && onChange) onChange(e.getHTML())
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-1 flex-col rounded-card-lg border border-obsidian/10 bg-fog/60 p-4 shadow-soft">
        <div className="flex items-center justify-between gap-2 px-1">
          <p className="text-[13px] font-semibold text-obsidian">Intro statement</p>
          <span className="text-[11px] text-obsidian/50">Path: /work/:slug/intro</span>
        </div>

        <div className="flex flex-1 flex-col rounded-card-lg border border-obsidian/10 bg-white overflow-hidden shadow-soft">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-1 border-b border-obsidian/10 bg-fog/70 px-3 py-2 rounded-t-lg">
            <Button
              size="sm"
              variant="ghost"
              icon={Undo2}
              onClick={() => editor?.chain().focus().undo().run()}
              disabled={disabled || !editor?.can()?.undo()}
              title="Undo"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Redo2}
              onClick={() => editor?.chain().focus().redo().run()}
              disabled={disabled || !editor?.can()?.redo()}
              title="Redo"
            />
            <span className="mx-1 h-5 w-px bg-obsidian/10" />
            <Button
              size="sm"
              variant="ghost"
              icon={Bold}
              onClick={() => editor?.chain().focus().toggleBold().run()}
              disabled={disabled}
              title="Bold (Ctrl+B)"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Italic}
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              disabled={disabled}
              title="Italic (Ctrl+I)"
            />
            <span className="mx-1 h-5 w-px bg-obsidian/10" />
            <Button
              size="sm"
              variant="ghost"
              icon={Link2}
              onClick={() => {
                if (!editor) return
                const sel = window.getSelection()
                const range = sel?.getRangeAt(0)
                const url = range && !range.collapsed
                  ? prompt('Link URL (e.g. /work or https://example.com):')
                  : ''
                if (url && /^(https?:\/\/|mailto:)/.test(url.trim())) {
                  editor.chain().focus().setLink({ href: url.trim() }).run()
                }
              }}
              disabled={disabled}
              title="Link"
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Highlighter}
              onClick={() => editor?.chain().focus().toggleMark('highlight').run()}
              disabled={disabled}
              title="Highlight"
              style={{ backgroundColor: '#e2cbff' }}
            />
          </div>

          {/* Content editable */}
          <div className="relative flex min-h-[200px] flex-1 overflow-auto" style={{ maxHeight: '320px' }}>
            <EditorContent editor={editor} />
          </div>

          {content && (
            <div className="px-3 py-2 text-[11px] text-obsidian/50 border-t border-obsidian/10">
              {content.length > 1000 ? `${content.length / 1000} kB` : `${content.length} characters`}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
