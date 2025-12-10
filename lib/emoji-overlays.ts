import type { CaptionSegment, RenderOverlay } from "@/lib/pipeline"

const EMOJI_MAP: Record<string, string> = {
  // Money / Wealth
  money: "https://raw.githubusercontent.com/notankith/cloudinarytest/refs/heads/main/Money.gif",
  cash: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4b5.png",
  rich: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4b8.png",
  wealth: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4b8.png",
  profit: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4c8.png",
  growth: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4c8.png",
  upgrade: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f680.png",
  boss: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4aa.png",

  // Winning / Energy
  win: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f3c6.png",
  victory: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f3c6.png",
  hype: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png",
  fire: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png",
  lit: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png",
  trending: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png",
  wow: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f929.png",
  awesome: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f929.png",
  shocked: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f631.png",
  speed: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4ab.png",
  fast: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4ab.png",
  rocket: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f680.png",

  // Danger / Chaos
  danger: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/26a0.png",
  warning: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/26a0.png",
  caution: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/26a0.png",
  boom: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4a5.png",
  explosion: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4a5.png",
  dead: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2620.png",
  skull: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2620.png",
  crazy: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f92f.png",

  // Emotions
  love: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2764.png",
  heart: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2764.png",
  broken: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f494.png",
  sad: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f622.png",
  cry: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f622.png",
  surprise: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f632.png",
  fear: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f631.png",
  smile: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f642.png",
  happy: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f642.png",
  angry: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f620.png",

  // Magic / Fun
  star: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2b50.png",
  sparkle: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2728.png",
  magic: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2728.png",
  party: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f389.png",
  celebrate: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f389.png",
  king: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f451.png",
  queen: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f451.png",
  gift: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f381.png",
  blast: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4a3.png",

  // Brain / Logic
  idea: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4a1.png",
  light: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4a1.png",
  brain: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f9e0.png",
  smart: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f9e0.png",
  thinking: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f914.png",
  question: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2753.png",
  check: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2705.png",

  // Misc
  break: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6a8.png",
  alert: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f6a8.png",
  flex: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f4aa.png",
  freeze: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/2744.png",
  heat: "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f525.png",
  "thumbs-up": "https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f44d.png",
}

export function buildEmojiOverlaysFromSegments(
  segments: CaptionSegment[],
  customStyles?: {
    playResX?: number
    playResY?: number
    marginV?: number
    emojiOffsetPx?: number
    emojiRiseMs?: number
    emojiSize?: number
  }
): RenderOverlay[] {
  const overlays: RenderOverlay[] = []

  const playResY = customStyles?.playResY ?? 1080
  const marginV = typeof customStyles?.marginV === "number" ? customStyles!.marginV! : 50

  // base is the caption baseline reference used by caption generator: base = playResY - marginV
  const captionBase = Math.round(playResY - marginV)

  const defaultOffset = Math.round(playResY * 0.03) || 30
  const emojiOffset = typeof customStyles?.emojiOffsetPx === "number" ? customStyles!.emojiOffsetPx! : defaultOffset
  const riseMs = typeof customStyles?.emojiRiseMs === "number" ? customStyles!.emojiRiseMs! : 400
  const emojiSize = typeof customStyles?.emojiSize === "number" ? customStyles!.emojiSize! : 140

  segments.forEach((segment) => {
    const tokens = segment.text.toLowerCase().split(/\s+/)
    tokens.forEach((token) => {
      const clean = token.replace(/[^a-z0-9-]/g, "")
      const emojiUrl = EMOJI_MAP[clean]
      if (emojiUrl) {
        // targetY: place emoji slightly below the caption baseline (so it appears under the text)
        // then the worker will animate it upward a bit for a small rise effect.
        const targetY = captionBase + emojiOffset

        overlays.push({
          url: emojiUrl,
          start: segment.start,
          end: segment.end,
          x: 0,
          y: targetY,
          width: emojiSize,
          // include the source playResY and rise duration so the worker can scale coordinates and animate
          playResY,
          riseMs,
        } as any)
      }
    })
  })

  return overlays
}
