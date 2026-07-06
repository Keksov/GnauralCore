import { computed, type Ref } from 'vue'

import {
  computePeaks,
  sampleAt,
  type AudioModelInfo,
  type AudioPeak,
} from './audio-model'

// SF22.1: reactive wrapper over the decoded AudioBuffer exposing the audio-model queries the
// waveform view + cursor readout use. Channel Float32Arrays are pulled lazily from the buffer
// (immutable) and cached by buffer identity so repeated peak reads don't re-fetch.

export interface UseAudioModel {
  readonly info: Ref<AudioModelInfo | null>
  /** Raw samples for a channel (clamped), or an empty array when unavailable. */
  channel(aChannel: number): Float32Array
  /** Nearest-sample value of a channel at a time. */
  sampleAt(aTimeSec: number, aChannel: number): number
  /** Min/max/RMS buckets for a channel over [startSec, endSec], `buckets` wide. */
  peaks(aStartSec: number, aEndSec: number, aBuckets: number, aChannel: number): AudioPeak[]
}

const EMPTY = new Float32Array(0)

export function useAudioModel(aBuffer: Ref<AudioBuffer | null>): UseAudioModel {
  const info = computed<AudioModelInfo | null>(() => {
    const buf = aBuffer.value
    if (buf === null) return null
    return {
      sampleRate: buf.sampleRate,
      length: buf.length,
      durationSec: buf.duration,
      channels: buf.numberOfChannels,
    }
  })

  // Cache channel data by (buffer, channel) so we don't call getChannelData on every read.
  let cacheBuffer: AudioBuffer | null = null
  const cacheChannels = new Map<number, Float32Array>()

  function channel(aChannel: number): Float32Array {
    const buf = aBuffer.value
    if (buf === null) return EMPTY
    if (buf !== cacheBuffer) {
      cacheBuffer = buf
      cacheChannels.clear()
    }
    const ch = Math.max(0, Math.min(buf.numberOfChannels - 1, Math.floor(aChannel)))
    let data = cacheChannels.get(ch)
    if (data === undefined) {
      data = buf.getChannelData(ch)
      cacheChannels.set(ch, data)
    }
    return data
  }

  return {
    info,
    channel,
    sampleAt(aTimeSec, aChannel) {
      const buf = aBuffer.value
      if (buf === null) return 0
      return sampleAt(channel(aChannel), aTimeSec, buf.sampleRate)
    },
    peaks(aStartSec, aEndSec, aBuckets, aChannel) {
      const buf = aBuffer.value
      if (buf === null) return []
      const sr = buf.sampleRate
      return computePeaks(channel(aChannel), aStartSec * sr, aEndSec * sr, aBuckets)
    },
  }
}
