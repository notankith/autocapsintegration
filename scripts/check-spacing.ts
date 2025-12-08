import { buildCaptionFile } from "../lib/captions"
import type { CaptionSegment } from "../lib/pipeline"

const sampleSegments: CaptionSegment[] = [
  {
    id: "seg1",
    start: 0,
    end: 2.4,
    text: "write strong hooks stay on brand",
    words: [
      { text: "write", start: 0, end: 0.4 },
      { text: "strong", start: 0.4, end: 0.8 },
      { text: "hooks", start: 0.8, end: 1.2 },
      { text: "stay", start: 1.2, end: 1.6 },
      { text: "on", start: 1.6, end: 2.0 },
      { text: "brand", start: 2.0, end: 2.4 },
    ],
  },
]

const result = buildCaptionFile("karaoke", sampleSegments, {
  playResX: 1920,
  playResY: 1080,
})

const dialogueLines = result.content
  .split("\n")
  .filter((line) => line.startsWith("Dialogue"))

const posMatches = Array.from(result.content.matchAll(/\\pos\((\d+),(\d+)\)/g))
const uniqueYPositions = [...new Set(posMatches.map((match) => Number(match[2])))]

console.log("Detected Y positions:", uniqueYPositions)
if (uniqueYPositions.length >= 2) {
  console.log("Vertical gap (px):", uniqueYPositions[1] - uniqueYPositions[0])
}

console.log("Sample dialogue lines:\n", dialogueLines.slice(0, 4).join("\n"))
