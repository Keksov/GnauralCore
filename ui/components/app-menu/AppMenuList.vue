<template>
  <!-- MR1.1 / MR2.x: recursive menu list. A container node renders a sideways q-menu (anchor top end
       / self top start) + a chevron that AUTO-OPENS on hover after a short delay (owner 2026-07-14);
       a leaf emits `select` and closes its popup. -->
  <q-list dense class="app-menu-list">
    <template v-for="node in nodes" :key="node.id">
      <q-item
        v-if="menuNodeHasChildren(node)"
        clickable
        :disable="menuNodeDisabled(node)"
        @mouseenter="onContainerEnter(node.id)"
        @mouseleave="onContainerLeave"
        @click="showSubmenu(node.id)"
      >
        <q-item-section v-if="node.icon" avatar>
          <q-icon :name="node.icon" size="18px" />
        </q-item-section>
        <q-item-section>{{ t(node.labelKey) }}</q-item-section>
        <q-item-section side>
          <q-icon name="chevron_right" size="16px" />
        </q-item-section>
        <q-menu
          :ref="(el) => setSubmenuRef(node.id, el)"
          anchor="top end"
          self="top start"
          no-parent-event
        >
          <app-menu-list :nodes="node.children ?? []" @select="emit('select', $event)" />
        </q-menu>
      </q-item>

      <q-item
        v-else
        clickable
        v-close-popup
        :disable="menuNodeDisabled(node)"
        @click="emit('select', node)"
      >
        <q-item-section v-if="node.icon" avatar>
          <q-icon :name="node.icon" size="18px" />
        </q-item-section>
        <q-item-section>{{ t(node.labelKey) }}</q-item-section>
        <q-item-section v-if="node.shortcut" side>
          <span class="text-caption text-grey">{{ node.shortcut }}</span>
        </q-item-section>
      </q-item>
    </template>
  </q-list>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import type { QMenu } from 'quasar'
import { menuNodeDisabled, menuNodeHasChildren, type MenuNode } from './menu-node'

defineOptions({ name: 'AppMenuList' })

defineProps<{ readonly nodes: readonly MenuNode[] }>()

const emit = defineEmits<{ select: [node: MenuNode] }>()

const { t } = useI18n()

// Hover-to-open with a small, barely-perceptible delay (owner 2026-07-14). Each container node's
// q-menu is registered by id; hovering the item shows it (and hides sibling submenus at this level).
const SUBMENU_HOVER_DELAY_MS = 120
const submenuRefs = new Map<string, QMenu>()
let hoverTimer: ReturnType<typeof setTimeout> | null = null

function setSubmenuRef(id: string, el: unknown): void {
  if (el === null || el === undefined) {
    submenuRefs.delete(id)
    return
  }
  submenuRefs.set(id, el as QMenu)
}

function clearHoverTimer(): void {
  if (hoverTimer !== null) {
    clearTimeout(hoverTimer)
    hoverTimer = null
  }
}

function showSubmenu(id: string): void {
  submenuRefs.forEach((menu, key) => {
    if (key !== id) {
      menu.hide()
    }
  })
  submenuRefs.get(id)?.show()
}

function onContainerEnter(id: string): void {
  clearHoverTimer()
  hoverTimer = setTimeout(() => {
    hoverTimer = null
    showSubmenu(id)
  }, SUBMENU_HOVER_DELAY_MS)
}

function onContainerLeave(): void {
  clearHoverTimer()
}

onBeforeUnmount(clearHoverTimer)
</script>

<style scoped lang="scss">
/* MR4.1 (owner 2026-07-15): smaller menu icons. Quasar's avatar slot reserves its width for a 24px
   icon, so an 18px one would float in a gutter — tighten the slot to match the icon. */
.app-menu-list :deep(.q-item__section--avatar) {
  min-width: 24px;
  padding-right: 12px;
}
</style>
