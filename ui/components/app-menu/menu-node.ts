// MR1.1 (menu-redesign): the declarative menu model shared by the single «Меню» dropdown.
// A node is either a container (has `children`, opens a sideways submenu) or a leaf (has `run`).
// The flat set of leaf ids also feeds the MRU (MR3.1) via a registry built in AudioPage.
export interface MenuNode {
  readonly id: string
  readonly labelKey: string
  readonly icon?: string
  readonly shortcut?: string
  readonly run?: () => void
  readonly children?: readonly MenuNode[]
  readonly disabled?: () => boolean
  // When true, invoking this command is NOT recorded in the recent-commands (MRU) list (e.g. «Выход»).
  readonly noMru?: boolean
}

export function menuNodeHasChildren(node: MenuNode): boolean {
  return node.children !== undefined && node.children.length > 0
}

export function menuNodeDisabled(node: MenuNode): boolean {
  return node.disabled?.() ?? false
}
