import { dirname, isAbsolute, resolve } from 'node:path'

export interface GnauralExecutablePathInfo {
  readonly gnauralCwd: string
  readonly gnauralExePath: string
}

const DEFAULT_GNAURAL_EXE_PATH = resolve(import.meta.dir, '..', 'cli', 'gnaural', 'build', 'x64', 'Gnaural.exe')

const normalizeOverridePath = (aValue: string | undefined): string | null => {
  if (aValue === undefined) {
    return null
  }

  const trimmed = aValue.trim()
  if (trimmed === '') {
    return null
  }

  return isAbsolute(trimmed) ? trimmed : resolve(trimmed)
}

export const resolveGnauralExecutablePath = (): GnauralExecutablePathInfo => {
  const gnauralExePath = normalizeOverridePath(process.env.GNAURAL_EXE) ?? DEFAULT_GNAURAL_EXE_PATH

  return {
    gnauralCwd: dirname(gnauralExePath),
    gnauralExePath,
  }
}