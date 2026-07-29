import { describe, it, expect } from 'vitest'
import { safeJsonParse, clamp, parseCpuToMillicores, parseMemoryToMiB } from '../server.js'

describe('safeJsonParse', () => {
  it('parses valid JSON', () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 })
  })

  it('returns fallback for invalid JSON', () => {
    expect(safeJsonParse('not-json', [])).toEqual([])
  })

  it('returns null as default fallback', () => {
    expect(safeJsonParse('{')).toBeNull()
  })

  it('parses JSON arrays', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3])
  })
})

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to min', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  it('clamps to max', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('allows value exactly at boundaries', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

describe('parseCpuToMillicores', () => {
  it('returns 0 for falsy input', () => {
    expect(parseCpuToMillicores(null)).toBe(0)
    expect(parseCpuToMillicores('')).toBe(0)
  })

  it('parses nanocores (n)', () => {
    expect(parseCpuToMillicores('1000000n')).toBeCloseTo(1)
  })

  it('parses microcores (u)', () => {
    expect(parseCpuToMillicores('1000u')).toBeCloseTo(1)
  })

  it('parses millicores (m)', () => {
    expect(parseCpuToMillicores('250m')).toBe(250)
  })

  it('parses whole cores (no unit)', () => {
    expect(parseCpuToMillicores('2')).toBe(2000)
  })
})

describe('parseMemoryToMiB', () => {
  it('returns 0 for falsy input', () => {
    expect(parseMemoryToMiB(null)).toBe(0)
    expect(parseMemoryToMiB('')).toBe(0)
  })

  it('parses Kibibytes (Ki)', () => {
    expect(parseMemoryToMiB('1024Ki')).toBeCloseTo(1)
  })

  it('parses Mebibytes (Mi)', () => {
    expect(parseMemoryToMiB('128Mi')).toBe(128)
  })

  it('parses Gibibytes (Gi)', () => {
    expect(parseMemoryToMiB('1Gi')).toBe(1024)
  })

  it('defaults to MiB for bare numbers', () => {
    expect(parseMemoryToMiB('512')).toBe(512)
  })

  it('returns 0 for unrecognised format', () => {
    expect(parseMemoryToMiB('abc')).toBe(0)
  })
})
