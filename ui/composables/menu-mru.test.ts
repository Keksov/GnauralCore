import { describe, expect, test } from 'bun:test'
import { MENU_MRU_MAX, parseStoredMru, pushMru } from './menu-mru'

describe('pushMru', () => {
  test('prepends a new id', () => {
    expect(pushMru(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  test('dedups by moving an existing id to the front', () => {
    expect(pushMru(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
  })

  test('re-pushing the head keeps the order', () => {
    expect(pushMru(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })

  test('caps the list at the max length', () => {
    const result = pushMru(['a', 'b', 'c', 'd', 'e'], 'f')
    expect(result).toEqual(['f', 'a', 'b', 'c', 'd'])
    expect(result).toHaveLength(MENU_MRU_MAX)
  })

  test('does not mutate the input', () => {
    const input = ['a', 'b']
    pushMru(input, 'c')
    expect(input).toEqual(['a', 'b'])
  })
})

describe('parseStoredMru', () => {
  test('null -> empty', () => {
    expect(parseStoredMru(null)).toEqual([])
  })

  test('valid array of strings round-trips', () => {
    expect(parseStoredMru(JSON.stringify(['a', 'b', 'c']))).toEqual(['a', 'b', 'c'])
  })

  test('non-string entries are dropped', () => {
    expect(parseStoredMru(JSON.stringify(['a', 1, null, 'b']))).toEqual(['a', 'b'])
  })

  test('dedups and caps corrupt/overlong data', () => {
    expect(parseStoredMru(JSON.stringify(['a', 'a', 'b', 'c', 'd', 'e', 'f']))).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  test('invalid json -> empty', () => {
    expect(parseStoredMru('{not json')).toEqual([])
  })

  test('non-array json -> empty', () => {
    expect(parseStoredMru(JSON.stringify({ a: 1 }))).toEqual([])
  })
})
