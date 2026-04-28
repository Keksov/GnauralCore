import { inject } from 'vue'
import { GNAURAL_WS_KEY, type GnauralWsService } from '../plugin'

export function useWsService(): GnauralWsService {
  const ws = inject(GNAURAL_WS_KEY)
  if (ws === undefined) {
    throw new Error('Gnaural WS service has not been provided')
  }

  return ws
}