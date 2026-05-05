import type { PromptInfo } from "./history"

export type PromptPartExtmark = {
  id: number
  start: number
  end: number
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function segmentWidth(segment: string) {
  if (segment === "\n") return 1
  return Bun.stringWidth(segment)
}

function stringIndexToDisplayOffset(text: string, index: number) {
  let displayOffset = 0
  for (const segment of segmenter.segment(text)) {
    if (segment.index >= index) return displayOffset
    displayOffset += segmentWidth(segment.segment)
  }
  return displayOffset
}

export function displayOffsetToStringIndex(text: string, offset: number) {
  if (offset <= 0) return 0

  let displayOffset = 0
  for (const segment of segmenter.segment(text)) {
    const nextDisplayOffset = displayOffset + segmentWidth(segment.segment)
    if (nextDisplayOffset > offset) return segment.index
    if (nextDisplayOffset === offset) return segment.index + segment.segment.length
    displayOffset = nextDisplayOffset
  }

  return text.length
}

function virtualTextRange(text: string, extmark: PromptPartExtmark, virtualText: string) {
  const start = displayOffsetToStringIndex(text, extmark.start)
  const end = displayOffsetToStringIndex(text, extmark.end)
  if (text.slice(start, end) === virtualText) return { start, end }

  const ranges: Array<{ start: number; end: number }> = []
  let index = text.indexOf(virtualText)
  while (index !== -1) {
    ranges.push({ start: index, end: index + virtualText.length })
    index = text.indexOf(virtualText, index + virtualText.length)
  }

  return (
    ranges.sort(
      (a, b) =>
        Math.abs(stringIndexToDisplayOffset(text, a.start) - extmark.start) -
          Math.abs(stringIndexToDisplayOffset(text, b.start) - extmark.start) || b.start - a.start,
    )[0] ?? { start, end }
  )
}

export function expandPromptTextParts(
  input: string,
  extmarks: readonly PromptPartExtmark[],
  extmarkToPartIndex: ReadonlyMap<number, number>,
  parts: PromptInfo["parts"],
) {
  return [...extmarks]
    .sort((a, b) => b.start - a.start)
    .reduce((text, extmark) => {
      const partIndex = extmarkToPartIndex.get(extmark.id)
      const part = partIndex === undefined ? undefined : parts[partIndex]
      if (part?.type !== "text" || !part.text) return text

      const range = part.source?.text.value
        ? virtualTextRange(text, extmark, part.source.text.value)
        : {
            start: displayOffsetToStringIndex(text, extmark.start),
            end: displayOffsetToStringIndex(text, extmark.end),
          }
      return text.slice(0, range.start) + part.text + text.slice(range.end)
    }, input)
}
