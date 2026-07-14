<template>
  <!-- MR1.1: recursive menu list. A container node renders a sideways q-menu (anchor top end /
       self top start) + a chevron; a leaf emits `select` and closes its popup. -->
  <q-list dense class="app-menu-list">
    <template v-for="node in nodes" :key="node.id">
      <q-item
        v-if="menuNodeHasChildren(node)"
        clickable
        :disable="menuNodeDisabled(node)"
      >
        <q-item-section v-if="node.icon" avatar>
          <q-icon :name="node.icon" />
        </q-item-section>
        <q-item-section>{{ t(node.labelKey) }}</q-item-section>
        <q-item-section side>
          <q-icon name="chevron_right" />
        </q-item-section>
        <q-menu anchor="top end" self="top start">
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
          <q-icon :name="node.icon" />
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
import { useI18n } from 'vue-i18n'
import { menuNodeDisabled, menuNodeHasChildren, type MenuNode } from './menu-node'

defineOptions({ name: 'AppMenuList' })

defineProps<{ readonly nodes: readonly MenuNode[] }>()

const emit = defineEmits<{ select: [node: MenuNode] }>()

const { t } = useI18n()
</script>
