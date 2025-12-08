export interface CaptionTemplate {
  name: string
  fontFamily: string
  fontSize: number
  primaryColor: string
  outlineColor: string
  outlineWidth: number
  shadowColor: string
  shadowWidth: number
  alignment: number
  marginV: number
  uppercase?: boolean
  karaoke?: {
    // Single highlightColor kept for backwards compatibility
    highlightColor?: string
    // Optional list of colors to cycle through for karaoke highlighting
    highlightColors?: string[]
    // Number of chunks to show before cycling to the next color (default 2)
    cycleAfterChunks?: number
    // Limit how many sentence lines render simultaneously (default 1)
    maxLinesPerChunk?: number
    // Relative gap between stacked lines (multiplier of font size)
    lineGapRatio?: number
    // Desired vertical center for stacked lines (percentage of frame height)
    lineCenterPercent?: number
    mode: "word" | "syllable"
  }
}

export type TemplateOption = {
  id: string
  name: string
  description: string
  accent: string
  background: string
  badge?: string
  renderTemplate: string
  previewImage?: string
}
