import { CaptionTemplate } from "./types"

export function generatePreviewCSS(template: CaptionTemplate): React.CSSProperties {
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
  } = template

  const alignStyle = applyAlignmentASS(alignment)
  
  // ASS Outline -> CSS text-shadow multiple layers
  // We generate concentric rings to simulate a stroke
  const outlineShadows: string[] = []
  if (outlineWidth > 0) {
    // Generate 8 points around the circle for each pixel of width? 
    // Or just simple offsets. 
    // A common trick for "stroke" in CSS is multiple shadows.
    // For pixel accuracy with ASS, ASS draws a border.
    // We can approximate with 8-way offsets for each integer step up to outlineWidth.
    // Or just 4-way if width is small.
    // Let's do a robust multi-layer shadow.
    for (let i = 1; i <= Math.ceil(outlineWidth); i++) {
      outlineShadows.push(`-${i}px -${i}px 0 ${outlineColor}`)
      outlineShadows.push(`${i}px -${i}px 0 ${outlineColor}`)
      outlineShadows.push(`-${i}px ${i}px 0 ${outlineColor}`)
      outlineShadows.push(`${i}px ${i}px 0 ${outlineColor}`)
      // Add cardinal directions for better coverage
      outlineShadows.push(`0 -${i}px 0 ${outlineColor}`)
      outlineShadows.push(`0 ${i}px 0 ${outlineColor}`)
      outlineShadows.push(`-${i}px 0 0 ${outlineColor}`)
      outlineShadows.push(`${i}px 0 0 ${outlineColor}`)
    }
  }

  // ASS Shadow -> text-shadow offset
  // ASS shadow is a drop shadow offset by shadowWidth in X and Y
  // It is drawn BEHIND the outline.
  // In CSS text-shadow, the first defined is on top. So outline first, then shadow.
  const dropShadows: string[] = []
  if (shadowWidth > 0) {
    // ASS shadow is usually a solid copy offset by shadowWidth
    // It respects the outline too? 
    // In ASS, "Shadow" is the distance of the shadow from the text.
    // The shadow color is BackColour.
    // It usually includes the outline thickness in the offset if OpaqueBox is not used.
    // Let's just do a simple offset shadow for now as requested: "For shadowWidth S → add offset shadow layer"
    dropShadows.push(`${shadowWidth}px ${shadowWidth}px 0 ${shadowColor}`)
  }

  const textShadow = [...outlineShadows, ...dropShadows].join(", ")

  return {
    fontFamily,
    fontSize: `${fontSize}px`, // Use exact px as requested
    color: primaryColor,
    textShadow: textShadow || undefined,
    position: "absolute",
    ...alignStyle,
    // Handle marginV
    // If bottom aligned, bottom = marginV
    // If top aligned, top = marginV
    // If middle, marginV might be ignored or offset? ASS usually ignores marginV for middle (alignment 5).
    // We'll apply marginV in the alignment helper or here.
    // Let's apply it here based on alignment.
    bottom: isBottom(alignment) ? `${marginV}px` : undefined,
    top: isTop(alignment) ? `${marginV}px` : undefined,
    // For middle (5), we center vertically.
    textTransform: uppercase ? "uppercase" : undefined,
  }
}

function isBottom(alignment: number) {
  return alignment >= 1 && alignment <= 3
}

function isTop(alignment: number) {
  return alignment >= 7 && alignment <= 9
}

export function applyAlignmentASS(alignment: number): React.CSSProperties {
  // ASS Alignment (NumPad layout)
  // 7 8 9
  // 4 5 6
  // 1 2 3
  
  const style: React.CSSProperties = {
    left: "50%", // Default center X
    transform: "translateX(-50%)", // Default center X
    textAlign: "center",
  }

  // Horizontal
  if ([1, 4, 7].includes(alignment)) {
    // Left
    style.left = "40px" // MarginL default 40
    style.transform = undefined // No translate
    style.textAlign = "left"
  } else if ([3, 6, 9].includes(alignment)) {
    // Right
    style.left = undefined
    style.right = "40px" // MarginR default 40
    style.transform = undefined
    style.textAlign = "right"
  }

  // Vertical
  if ([1, 2, 3].includes(alignment)) {
    // Bottom - handled by marginV in generatePreviewCSS
  } else if ([7, 8, 9].includes(alignment)) {
    // Top - handled by marginV in generatePreviewCSS
  } else if ([4, 5, 6].includes(alignment)) {
    // Middle
    style.top = "50%"
    style.transform = (style.transform || "") + " translateY(-50%)"
  }

  return style
}

export function generateASS(template: CaptionTemplate): string {
  const {
    name,
    fontFamily,
    fontSize,
    primaryColor,
    outlineColor,
    outlineWidth,
    shadowColor,
    shadowWidth,
    alignment,
    marginV,
  } = template

  const primary = toAssColor(primaryColor)
  const outline = toAssColor(outlineColor)
  const shadow = toAssColor(shadowColor) // BackColour in ASS is often used for shadow or box

  // Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
  // We assume SecondaryColour = Primary (unless karaoke), BackColour = ShadowColor
  
  return `Style: ${name},${fontFamily},${fontSize},${primary},${primary},${outline},${shadow},-1,0,0,0,100,100,0,0,1,${outlineWidth},${shadowWidth},${alignment},-10,40,${marginV},1`
}

export function toAssColor(hex: string): string {
  // Hex: #RRGGBB or #RRGGBBAA
  // ASS: &H00BBGGRR or &HAABBGGRR
  
  let clean = hex.replace("#", "")
  let alpha = "00"

  if (clean.length === 8) {
    const a = parseInt(clean.slice(6, 8), 16)
    const invA = 255 - a
    alpha = invA.toString(16).toUpperCase().padStart(2, "0")
    clean = clean.slice(0, 6)
  } else if (clean.length === 3) {
    clean = clean[0]+clean[0] + clean[1]+clean[1] + clean[2]+clean[2]
  }

  const r = clean.slice(0, 2)
  const g = clean.slice(2, 4)
  const b = clean.slice(4, 6)

  return `&H${alpha}${b}${g}${r}`
}

