import { z } from "zod"

// All files now stored in single Oracle bucket via PAR URL
export const STORAGE_PREFIX = {
  uploads: "uploads",
  captions: "captions",
  renders: "renders",
} as const

const retentionEnv = Number(process.env.FILE_RETENTION_DAYS ?? "")
export const RETENTION_WINDOW_DAYS = Number.isFinite(retentionEnv) && retentionEnv > 0 ? retentionEnv : null

export const RENDER_RESOLUTIONS = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
} as const

export const RESOLUTION_OPTIONS = ["720p", "1080p"] as const
export type RenderResolution = (typeof RESOLUTION_OPTIONS)[number]

export const CAPTION_TEMPLATES = ["glowy", "minimal", "karaoke"] as const
export type CaptionTemplate = (typeof CAPTION_TEMPLATES)[number]

export type CaptionWord = {
  start: number
  end: number
  text: string
  confidence?: number
  speaker?: string
}

export type CaptionSegment = {
  id: string
  start: number
  end: number
  text: string
  words?: CaptionWord[]
}

export type RenderOverlay = {
  url: string
  start: number
  end: number
  // optional position/size hint in pixels
  x?: number
  y?: number
  width?: number
  height?: number
  // Optional local path (worker downloads external files and sets this)
  path?: string
}

const captionWordSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
  confidence: z.number().optional(),
  speaker: z.string().optional(),
})

const captionSegmentPayloadSchema = z.object({
  id: z.string().optional(),
  start: z.number(),
  end: z.number(),
  text: z.string(),
  words: z.array(captionWordSchema).optional(),
})

export type TranscriptPayload = {
  text: string
  segments: CaptionSegment[]
}

const karaokeOverrideSchema = z.object({
  highlightColor: z.string().optional(),
  highlightColors: z.array(z.string()).optional(),
  cycleAfterChunks: z.number().optional(),
  maxLinesPerChunk: z.number().optional(),
  lineGapRatio: z.number().optional(),
  lineCenterPercent: z.number().optional(),
  mode: z.enum(["word", "syllable"]).optional(),
})

export const captionRequestSchema = z.object({
  uploadId: z.string().min(1),
  template: z.enum(CAPTION_TEMPLATES),
  resolution: z.enum(RESOLUTION_OPTIONS),
  transcriptId: z.string().min(1).optional(),
  translationId: z.string().min(1).optional(),
  segments: z.array(captionSegmentPayloadSchema).optional(),
  customStyles: z.object({
    fontSize: z.number().optional(),
    marginV: z.number().optional(),
    alignment: z.number().optional(),
    playResX: z.number().optional(),
    playResY: z.number().optional(),
    primaryColor: z.string().optional(),
    outlineColor: z.string().optional(),
    shadowColor: z.string().optional(),
    karaoke: karaokeOverrideSchema.optional(),
  }).optional(),
})

export function assertEnv(name: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
