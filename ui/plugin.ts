import type { BrowserMessage, SpectrogramClientMessage, SpectrogramServerMessage } from '@protocol'
import type { InjectionKey, Plugin, Ref } from 'vue'

export type GnauralConnectionState = 'connecting' | 'connected' | 'disconnected'

export interface GnauralWsService {
  readonly connectionState: Ref<GnauralConnectionState>
  send(message: BrowserMessage): boolean
  /** Send a spectrogram client message (additive protocol, outside BrowserMessage). */
  sendSpectrogram(message: SpectrogramClientMessage): boolean
  /** Subscribe to spectrogram server messages; returns an unsubscribe fn. */
  onSpectrogram(handler: (message: SpectrogramServerMessage) => void): () => void
}

export const GNAURAL_WS_KEY: InjectionKey<GnauralWsService> = Symbol('gnaural-ws')

export function createGnauralPlugin(options: { readonly ws: GnauralWsService }): Plugin {
  return {
    install(app) {
      app.provide(GNAURAL_WS_KEY, options.ws)
    },
  }
}