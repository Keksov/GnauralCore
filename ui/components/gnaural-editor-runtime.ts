import { EditorState, type Extension } from '@codemirror/state'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { xml } from '@codemirror/lang-xml'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'

const DESCRIPTION_TAG_REGEXP = /<description(?:\s[^>]*)?>|<\/description>/g

const descriptionTagDecorator = new MatchDecorator({
  regexp: DESCRIPTION_TAG_REGEXP,
  decoration: () => Decoration.mark({ class: 'gnaural-editor-panel__description-tag' }),
})

const descriptionTagHighlight: Extension = ViewPlugin.fromClass(class {
  public decorations

  public constructor(view: EditorView) {
    this.decorations = descriptionTagDecorator.createDeco(view)
  }

  public update(update: ViewUpdate): void {
    this.decorations = descriptionTagDecorator.updateDeco(update, this.decorations)
  }
}, {
  decorations: (value) => value.decorations,
})

export interface GnauralEditorRuntime {
  readonly EditorState: typeof EditorState
  readonly EditorView: typeof EditorView
  readonly basicSetup: typeof basicSetup
  readonly xml: typeof xml
  readonly oneDark: typeof oneDark
  readonly descriptionTagHighlight: Extension
}

export function createGnauralEditorRuntime(): GnauralEditorRuntime {
  return {
    EditorState,
    EditorView,
    basicSetup,
    xml,
    oneDark,
    descriptionTagHighlight,
  }
}