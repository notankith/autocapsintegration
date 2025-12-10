"use client"

import { useEffect, useRef } from "react"
import { type CaptionSegment } from "@/lib/pipeline"
import { type CaptionTemplate } from "@/components/templates/types"

interface CanvasCaptionRendererProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  captions: CaptionSegment[]
  template: CaptionTemplate
  onCaptionPosition?: (pos: { y: number; height: number }) => void
}

export function CanvasCaptionRenderer({ videoRef, captions, template, onCaptionPosition }: CanvasCaptionRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let animationFrameId: number

    const render = () => {
      // Sync canvas size to video size
      if (video.videoWidth && video.videoHeight) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const currentTime = video.currentTime
      const activeCaption = captions.find(
        (c) => {
          const start = typeof c.start === 'number' ? c.start : ((c as any).start_time ?? 0)
          const end = typeof c.end === 'number' ? c.end : ((c as any).end_time ?? 0)
          return currentTime >= start && currentTime <= end
        }
      )

          if (activeCaption) {
            // Compute global chunk start index (sum of chunk counts for captions before the active one)
            const computeChunkCount = (wCount: number) => Math.ceil(Math.max(0, wCount) / 3)
            const priorChunks = captions
              .filter((c) => c.start !== undefined && ((c as any).start ?? 0) < ((activeCaption as any).start ?? 0))
              .reduce((acc, c) => acc + computeChunkCount(c.words?.length ?? (c.text?.split(/\s+/).filter(Boolean).length ?? 0)), 0)

            drawCaption(ctx, activeCaption, template, currentTime, canvas.width, canvas.height, priorChunks)
            // compute caption baseline y to help overlay positioning
            const { marginV, alignment, fontSize } = template as any
            let y = canvas.height - (marginV ?? 40)
            if (alignment === 5) y = canvas.height / 2
            if (alignment === 8) y = marginV ?? 40
            if (typeof onCaptionPosition === 'function') {
              onCaptionPosition({ y, height: fontSize ?? 40 })
            }
      }

      animationFrameId = requestAnimationFrame(render)
    }

    render()

    return () => cancelAnimationFrame(animationFrameId)
  }, [videoRef, captions, template])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none w-full h-full object-contain"
    />
  )
}

function drawCaption(
  ctx: CanvasRenderingContext2D,
  caption: CaptionSegment,
  template: CaptionTemplate,
  currentTime: number,
  width: number,
  height: number
  , globalChunkStart = 0
) {
  const {
    fontFamily,
    fontSize,
    primaryColor,
    outlineColor,
    outlineWidth,
    shadowColor,
    shadowWidth,
    alignment,
    marginV,
    uppercase,
    karaoke,
  } = template

  // Font setup
  ctx.font = `${fontSize}px "${fontFamily}"`
  ctx.textBaseline = "alphabetic" // We will handle Y manually for better control or use standard baselines

  const text = uppercase ? caption.text.toUpperCase() : caption.text
  
  const start = typeof caption.start === 'number' ? caption.start : ((caption as any).start_time ?? 0)
  const end = typeof caption.end === 'number' ? caption.end : ((caption as any).end_time ?? 0)

  let words = caption.words ? caption.words.map(w => ({...w, text: uppercase ? w.text.toUpperCase() : w.text})) : []

  if (words.length === 0 && text) {
    if (karaoke) {
       const tokens = text.split(/\s+/)
       const duration = Math.max(0, end - start)
       const perToken = duration / tokens.length
       words = tokens.map((token, i) => ({
           text: token,
           start: start + perToken * i,
           end: start + perToken * (i + 1)
       }))
    } else {
       words = [{ text, start, end }]
    }
  }

  // Calculate position
  let x = width / 2
  let y = height - marginV

  if (alignment === 5) {
    // If the template includes a karaoke.centerPercent override, respect it
    // for preview positioning so the preview matches final render placement.
    const centerPercent = (template as any)?.karaoke?.lineCenterPercent
    if (typeof centerPercent === 'number' && Number.isFinite(centerPercent)) {
      const clamped = Math.max(0, Math.min(100, centerPercent))
      y = (clamped / 100) * height
    } else {
      y = height / 2
    }
    ctx.textBaseline = "middle"
  } else if (alignment === 8) {
    y = marginV
    ctx.textBaseline = "top"
  } else {
    // Alignment 2 (Bottom Center)
    y = height - marginV
    ctx.textBaseline = "bottom"
  }

  // Measure total width for centering
  // We need to measure word by word to account for spacing if we draw word by word
  // Or we can measure the whole string if we just draw the string.
  // For karaoke, we MUST draw word by word or use clipping on the whole string.
  // But "Split text into words" was a requirement.
  
  const wordMetrics = words.map(w => {
    const metrics = ctx.measureText(w.text)
    return {
      word: w,
      width: metrics.width,
      text: w.text
    }
  })

  // Add spacing between words
  const spaceWidth = ctx.measureText(" ").width
  const totalWidth = wordMetrics.reduce((acc, curr, i) => acc + curr.width + (i < wordMetrics.length - 1 ? spaceWidth : 0), 0)

  let currentX = x - totalWidth / 2

  // Draw Shadow/Glow (Global for the line)
  ctx.save()
  ctx.shadowColor = shadowColor
  ctx.shadowBlur = shadowWidth
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
  
  if (outlineWidth > 0) {
    // Draw Outline (Stroke) with shadow
    ctx.strokeStyle = outlineColor
    ctx.lineWidth = outlineWidth * 2 // Stroke is centered
    ctx.lineJoin = "round"
    ctx.miterLimit = 2
    
    let strokeX = currentX
    for (let i = 0; i < wordMetrics.length; i++) {
      const wm = wordMetrics[i]
      ctx.strokeText(wm.text, strokeX, y)
      strokeX += wm.width + spaceWidth
    }
  } else if (shadowWidth > 0) {
    // Draw Fill with shadow (if no outline)
    ctx.fillStyle = primaryColor
    let shadowFillX = currentX
    for (let i = 0; i < wordMetrics.length; i++) {
      const wm = wordMetrics[i]
      ctx.fillText(wm.text, shadowFillX, y)
      shadowFillX += wm.width + spaceWidth
    }
  }
  ctx.restore()

  // Draw Fill (Primary Color) & Karaoke
  let fillX = currentX
  for (let i = 0; i < wordMetrics.length; i++) {
    const wm = wordMetrics[i]
    
    // Base fill
    ctx.fillStyle = primaryColor
    ctx.fillText(wm.text, fillX, y)

    // Karaoke Highlight
    if (karaoke && wm.word.start !== undefined && wm.word.end !== undefined) {
      const wordDuration = wm.word.end - wm.word.start
      const elapsed = currentTime - wm.word.start
      const progress = Math.max(0, Math.min(1, elapsed / wordDuration))

      // Determine highlight color for the chunk this word belongs to
      const wordIndex = i
      const chunkIndexInCaption = Math.floor(wordIndex / 3)
      const globalChunkIndex = globalChunkStart + chunkIndexInCaption
      const highlightColors = karaoke.highlightColors ?? (karaoke.highlightColor ? [karaoke.highlightColor] : ["#FFFF00"])
      const cycleAfter = karaoke.cycleAfterChunks ?? 2
      const colorIndex = Math.floor(globalChunkIndex / cycleAfter) % highlightColors.length
      const highlightColor = highlightColors[colorIndex]

      if (progress > 0) {
        ctx.save()
        // Create clipping region for the highlight
        // We need to know the height of the text to clip correctly
        // Approximate height from fontSize
        const clipHeight = fontSize * 1.5 
        const clipY = alignment === 8 ? y : (alignment === 5 ? y - fontSize/2 : y - fontSize)
        
        ctx.beginPath()
        ctx.rect(fillX, clipY - fontSize/2, wm.width * progress, clipHeight * 2) // Generous clip area
        ctx.clip()

        ctx.fillStyle = highlightColor
        ctx.fillText(wm.text, fillX, y)
        ctx.restore()
      }
    }

    fillX += wm.width + spaceWidth
  }
}
