import { CaptionTemplate, TemplateOption } from "./types"

export const CREATOR_KINETIC_TEMPLATE_ID = "creator-kinetic"

export const Templates: Record<string, CaptionTemplate> = {
  minimal: {
    name: "Minimal",
    fontFamily: "Inter",
    fontSize: 40,
    primaryColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 2,
    shadowColor: "#00000080",
    shadowWidth: 0,
    alignment: 2,
    marginV: 40,
  },
  glowy: {
    name: "Glowy",
    fontFamily: "Inter",
    fontSize: 62,
    primaryColor: "#FFFFFF",
    outlineColor: "#00000080",
    outlineWidth: 5,
    shadowColor: "#000000",
    shadowWidth: 18,
    alignment: 5,
    marginV: 40,
  },
  karaoke: {
    name: "CreatorKinetic",
    fontFamily: "THE BOLD FONT (FREE VERSION)",
    // Reduced by 15% (was 68), set to 58 to scale the text down
    fontSize: 58,
    primaryColor: "#FFFFFF",
    outlineColor: "#000000",
    // Thin stroke so FFmpeg export stays crisp
    outlineWidth: 1,
    shadowColor: "#000000",
    shadowWidth: 0,
    // Remove the default yellow highlight for creator-kinetic and instead use a cycling
    // highlight color sequence for each 2 chunks (adjust cycleAfterChunks as needed)
    karaoke: {
      highlightColors: ["#70e2ff", "#ffe83f", "#9fff5b"],
      cycleAfterChunks: 2,
      maxLinesPerChunk: 2,
      lineGapRatio: 0.22,
      mode: "word",
    },
    alignment: 5,
    marginV: 60,
    uppercase: true,
  },
  sportGlow: {
    name: "SportGlow",
    fontFamily: "Anton",
    fontSize: 82,
    primaryColor: "#FFFFFF",
    outlineColor: "#000000",
    outlineWidth: 8,
    shadowColor: "#000000",
    shadowWidth: 20,
    alignment: 5,
    marginV: 50,
    uppercase: true,
    karaoke: {
      highlightColor: "#FFFF40",
      mode: "word",
    },
  },
}

export const defaultTemplates: TemplateOption[] = [
  {
    id: CREATOR_KINETIC_TEMPLATE_ID,
    name: "Creator Kinetic",
    description:
      "RetroDream serif TikTok-style: zoom-in sentences, per-word neon glow, and kinetic timing.",
    accent: "#39FF14",
    background:
      "linear-gradient(135deg, #0f172a 0%, #111111 40%, #39ff14 100%)",
    badge: "Sports",
    renderTemplate: "karaoke",
    previewImage: "/image.png",
  },
  {
    id: "documentary",
    name: "Documentary",
    description: "Classic subtitle treatment with background plate and safe margins.",
    accent: "#0ea5e9",
    background: "linear-gradient(135deg, #38bdf8 0%, #1d4ed8 100%)",
    renderTemplate: "minimal",
    previewImage: "/download.jpg",
  },
]

export function findTemplateById(id?: string | null) {
  return (
    defaultTemplates.find((template) => template.id === id) ||
    defaultTemplates.find((template) => template.id === CREATOR_KINETIC_TEMPLATE_ID) ||
    defaultTemplates[0]
  )
}
