import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"

import { isPathInsideBase, resolveAllowedAudioFilePath } from "./audio-file-utils"

const win = process.platform === "win32"

describe("isPathInsideBase", () => {
  test("a path inside a normal folder root is inside", () => {
    expect(isPathInsideBase("C:\\Users\\1", "C:\\Users\\1\\proj\\.history")).toBe(true)
  })

  test("the base itself is inside", () => {
    expect(isPathInsideBase("C:\\a\\b", "C:\\a\\b")).toBe(true)
  })

  test("a sibling folder is NOT inside", () => {
    expect(isPathInsideBase("C:\\Users\\1", "C:\\Users\\2\\x")).toBe(false)
  })

  // Regression: async fs.realpath("D:\\") returns the bare "D:" (no trailing sep), which used to make
  // path.relative treat it as drive-relative and report every file on that drive as "outside" — the
  // save-time "History directory would be created outside the allowed roots" 403.
  test.skipIf(!win)("a bare drive-letter root ('D:') contains files on that drive", () => {
    expect(isPathInsideBase("D:", "D:\\music\\.history")).toBe(true)
    expect(isPathInsideBase("C:", "C:\\ProgramData\\foo\\.history")).toBe(true)
  })

  test.skipIf(!win)("a drive root WITH the trailing separator still works", () => {
    expect(isPathInsideBase("C:\\", "C:\\anywhere\\.history")).toBe(true)
    expect(isPathInsideBase("D:\\", "D:\\x\\.history")).toBe(true)
  })

  test.skipIf(!win)("a bare drive root does NOT contain a path on a different drive", () => {
    expect(isPathInsideBase("D:", "C:\\Users\\1\\x")).toBe(false)
  })
})

describe("resolveAllowedAudioFilePath (access-preset-root AR2.1)", () => {
  test("unrestricted (null roots): any supported audio file resolves", () => {
    const r = resolveAllowedAudioFilePath(join(tmpdir(), "anywhere", "s.gnaural"), null)
    expect(r).not.toBeNull()
    expect(r?.fileKind).toBe("gnaural")
  })

  test("unrestricted (null roots): a non-audio extension is still rejected", () => {
    expect(resolveAllowedAudioFilePath(join(tmpdir(), "s.txt"), null)).toBeNull()
  })

  test("restrict: an EMPTY roots array is deny-all, NOT unrestricted", () => {
    expect(resolveAllowedAudioFilePath(join(tmpdir(), "s.gnaural"), [])).toBeNull()
  })

  test("restrict: a file inside a root is allowed; a sibling outside is not", async () => {
    const root = await mkdtemp(join(tmpdir(), "ar21-"))
    try {
      const inside = join(root, "s.gnaural")
      await writeFile(inside, "<gnaural/>")
      expect(resolveAllowedAudioFilePath(inside, [root])).not.toBeNull()

      const outside = join(tmpdir(), `ar21-outside-${process.pid}.gnaural`)
      expect(resolveAllowedAudioFilePath(outside, [root])).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})
