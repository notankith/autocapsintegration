import { CaptionSegment, CaptionTemplate as CaptionTemplateId } from "@/lib/pipeline"
import { Templates } from "@/components/templates/data"
import { generateASS, toAssColor } from "@/components/templates/utils"
import { CaptionTemplate } from "@/components/templates/types"

function getAssHeader(playResX = 1920, playResY = 1080) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding`
}

const ASS_EVENTS_HEADER = `

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`

const CREATOR_KINETIC_MAX_WORDS_PER_LINE = 3
const DEFAULT_MAX_LINES_PER_CHUNK = 1
const DEFAULT_LINE_GAP_RATIO = 1.12
// const CREATOR_KINETIC_MAX_CHARS_PER_LINE = 25 // Removed in favor of dynamic calculation
type SegmentWord = NonNullable<CaptionSegment["words"]>[number]

type CaptionCustomStyles = {
  fontSize?: number
  marginV?: number
  alignment?: number
  playResX?: number
  playResY?: number
  marginL?: number
  marginR?: number
  karaoke?: Partial<NonNullable<CaptionTemplate["karaoke"]>>
}

export type CaptionFile = {
  format: "srt" | "ass"
  template: CaptionTemplateId
  content: string
}

export function buildCaptionFile(
  templateId: CaptionTemplateId, 
  segments: CaptionSegment[],
  customStyles?: CaptionCustomStyles
): CaptionFile {
  const baseTemplate = Templates[templateId]
  if (!baseTemplate) {
    return { format: "srt", template: templateId, content: toSrt(segments) }
  }

  // Merge custom styles while preserving karaoke nested config
  const { karaoke: karaokeOverrides, ...styleOverrides } = customStyles ?? {}
  const template: CaptionTemplate = {
    ...baseTemplate,
    ...styleOverrides,
    karaoke: baseTemplate.karaoke || karaokeOverrides
      ? { ...(baseTemplate.karaoke ?? {}), ...(karaokeOverrides ?? {}) }
      : baseTemplate.karaoke,
  }

  // Calculate dynamic max chars per line
  const playResX = styleOverrides.playResX ?? 1920
  const fontSize = template.fontSize ?? 40
  const marginL = template.marginL ?? 20
  const marginR = template.marginR ?? 20
  const safeWidth = playResX - marginL - marginR
  // Conservative estimate: average char width is ~0.55 of font size
  const charWidth = fontSize * 0.55 
  const maxCharsPerLine = Math.max(10, Math.floor(safeWidth / charWidth))

  let normalized = ensureWordTimings(segments)
  // Enforce safe layout (split long words)
  normalized = enforceSafeLayout(normalized, maxCharsPerLine)

  // Optionally clamp segment end times if a duration is provided
  if (typeof segments !== "undefined" && segments.length > 0) {
    const maxEnd = Math.max(...segments.map(s => s.end))
    // If segments extend past video duration, clamp them
    if (typeof (global as any).videoDuration === "number" && maxEnd > (global as any).videoDuration) {
      normalized = normalized.map(seg => ({
        ...seg,
        end: Math.min(seg.end, (global as any).videoDuration)
      }))
    }
  }

  // Generate ASS for all defined templates
  const content = generateAssFile(template, normalized, styleOverrides.playResX, styleOverrides.playResY, maxCharsPerLine)
  return { format: "ass", template: templateId, content }
}

function generateAssFile(template: CaptionTemplate, segments: CaptionSegment[], playResX?: number, playResY?: number, maxCharsPerLine: number = 25): string {
  const styleLine = generateASS(template)
  
  let events = ""
  if (template.karaoke) {
    events = generateKaraokeEvents(template, segments, maxCharsPerLine, playResX, playResY)
  } else {
    events = generateSimpleEvents(template, segments)
  }

  return `${getAssHeader(playResX, playResY)}\n${styleLine}${ASS_EVENTS_HEADER}\n${events}`
}

function generateSimpleEvents(template: CaptionTemplate, segments: CaptionSegment[]): string {
  return segments
    .map((seg) =>
      `Dialogue: 0,${formatAssTimestamp(seg.start)},${formatAssTimestamp(seg.end)},${template.name},,0,0,0,,${escapeAssText(
        seg.text.trim(),
      )}`,
    )
    .join("\n")
}

function generateKaraokeEvents(
  template: CaptionTemplate,
  segments: CaptionSegment[],
  maxCharsPerLine: number,
  playResX?: number,
  playResY?: number,
): string {
  const highlightColors =
    template.karaoke?.highlightColors ??
    (template.karaoke?.highlightColor ? [template.karaoke.highlightColor] : ["#FFFF00"]);
  const cycleAfter = template.karaoke?.cycleAfterChunks ?? 2;
  const maxLinesPerChunk = Math.max(1, template.karaoke?.maxLinesPerChunk ?? DEFAULT_MAX_LINES_PER_CHUNK);

  const lineBuckets: SegmentWord[][] = [];
  const baseColorAss = toAssColor(template.primaryColor);

  const pushLine = (line: SegmentWord[]) => {
    if (line.length) {
      lineBuckets.push(line);
    }
  };

  segments.forEach((segment) => {
    if (!segment.words?.length) return;

    const words = segment.words as SegmentWord[];
    let currentLine: SegmentWord[] = [];

    const flushLine = () => {
      if (currentLine.length) {
        pushLine(currentLine);
        currentLine = [];
      }
    };

    words.forEach((word, idx) => {
      const currentChars = currentLine.reduce((acc, w) => acc + w.text.length, 0);
      const addedLen = word.text.length + (currentLine.length > 0 ? 1 : 0);
      const exceedsChars = currentLine.length > 0 && currentChars + addedLen > maxCharsPerLine;
      const exceedsWords = currentLine.length >= CREATOR_KINETIC_MAX_WORDS_PER_LINE;

      if (exceedsChars || exceedsWords) {
        flushLine();
      }

      currentLine.push(word);

      const reachedLimit = currentLine.length >= CREATOR_KINETIC_MAX_WORDS_PER_LINE;
      const atEnd = idx === words.length - 1;
      if (reachedLimit || atEnd) {
        flushLine();
      }
    });

    flushLine();
  });

  if (!lineBuckets.length) {
    return "";
  }

  balanceLineWordCounts(lineBuckets);

  const chunkedLines: SegmentWord[][][] = [];
  for (let i = 0; i < lineBuckets.length; i += maxLinesPerChunk) {
    chunkedLines.push(lineBuckets.slice(i, i + maxLinesPerChunk));
  }

  if (chunkedLines.length >= 2) {
    const lastChunk = chunkedLines[chunkedLines.length - 1];
    if (lastChunk.length === 1) {
      const prevChunk = chunkedLines[chunkedLines.length - 2];
      if (prevChunk.length > 1) {
        lastChunk.unshift(prevChunk.pop()!);
      }
    }
  }

  let globalChunkIndex = 0;

  return chunkedLines
    .map((chunkLines) => {
      if (!chunkLines.length) return "";

      const chunkStart = chunkLines[0][0].start;
      const lastLine = chunkLines[chunkLines.length - 1];
      const chunkEnd = lastLine[lastLine.length - 1].end;

      const chunkZoomIn = `\\fscx80\\fscy80\\t(0,50,\\fscx100\\fscy100)`;
      const colorIndex = Math.floor(globalChunkIndex / cycleAfter) % highlightColors.length;
      const highlightColorAss = toAssColor(highlightColors[colorIndex]);

      const renderedLineStrings = chunkLines.map((lineWords) =>
        lineWords
          .map((word) => {
            const rel = Math.round((word.start - chunkStart) * 1000);
            const dur = Math.max(10, Math.round((word.end - word.start) * 1000));
            const highlightEnd = rel + dur;
            const txt = escapeAssText(word.text.toUpperCase());

            const base = `\\1c${baseColorAss}\\3c&H000000&\\bord0.6\\blur0.4\\shad0.15`;
            const highlight = `\\t(${rel},${rel + 50},\\1c${highlightColorAss})`;
            const reset = `\\t(${highlightEnd},${highlightEnd + 50},\\1c${baseColorAss})`;

            return `{${chunkZoomIn}${base}${highlight}${reset}}${txt}`;
          })
          .join(" ")
      );

      const glowLineStrings = chunkLines.map((lineWords) =>
        lineWords
          .map((word) => {
            const rel = Math.round((word.start - chunkStart) * 1000);
            const dur = Math.max(10, Math.round((word.end - word.start) * 1000));
            const highlightEnd = rel + dur;
            const txt = escapeAssText(word.text.toUpperCase());

            const base = `\\alpha&H60&\\1c${highlightColorAss}\\bord0\\blur10\\shad0`;
            const activate = `\\t(${rel},${rel + 50},\\alpha&H30&)`;
            const deactivate = `\\t(${highlightEnd},${highlightEnd + 80},\\alpha&H60&)`;

            return `{${chunkZoomIn}${base}${activate}${deactivate}}${txt}`;
          })
          .join(" ")
      );

      const positionedRendered = applyCustomLineSpacing(
        renderedLineStrings,
        template,
        playResX,
        playResY,
      );

      const positionedGlow = applyCustomLineSpacing(
        glowLineStrings,
        template,
        playResX,
        playResY,
      );

      globalChunkIndex++;

      return positionedRendered
        .map((lineText, idx) => {
          const glowText = positionedGlow[idx];
          const glowDialogue = `Dialogue: 0,${formatAssTimestamp(chunkStart)},${formatAssTimestamp(
            chunkEnd
          )},${template.name},,0,0,0,,${glowText}`;

          const coreDialogue = `Dialogue: 1,${formatAssTimestamp(chunkStart)},${formatAssTimestamp(
            chunkEnd
          )},${template.name},,0,0,0,,${lineText}`;

          return `${glowDialogue}\n${coreDialogue}`;
        })
        .join("\n");
    })
    .filter(Boolean)
    .join("\n");
}

function balanceLineWordCounts(lines: SegmentWord[][]) {
  if (lines.length < 2) return;
  const last = lines[lines.length - 1];
  if (last.length >= 2) return;

  for (let i = lines.length - 2; i >= 0; i--) {
    if (lines[i].length > 2) {
      last.unshift(lines[i].pop()!);
      return;
    }
  }
}

function computeLinePositions(
  lineCount: number,
  template: CaptionTemplate,
  playResX?: number,
  playResY?: number,
) {
  const safePlayResX = playResX ?? 1920;
  const safePlayResY = playResY ?? 1080;

  // ULTRA TIGHT SPACING
  const ratio = Math.max(0.01, template.karaoke?.lineGapRatio ?? DEFAULT_LINE_GAP_RATIO);
  const fontSize = template.fontSize ?? 58;

  // Keep lines extremely close while still rendered as distinct rows
  const step = Math.max(32, Math.round(fontSize * ratio * 3.2));

  const centerX = Math.round(safePlayResX / 2);
  const positions: number[] = [];

  const centerPercent = template.karaoke?.lineCenterPercent;
  if (typeof centerPercent === "number" && Number.isFinite(centerPercent)) {
    const clamped = Math.max(0, Math.min(100, centerPercent));
    const centerY = (clamped / 100) * safePlayResY;
    const totalSpan = step * (lineCount - 1);
    const first = centerY - totalSpan / 2;
    for (let i = 0; i < lineCount; i++) {
      positions.push(Math.round(first + i * step));
    }
    return { centerX, positions };
  }

  const alignment = template.alignment ?? 2;
  const verticalBand = alignment <= 3 ? "bottom" : alignment <= 6 ? "middle" : "top";
  const marginV = template.marginV ?? 50;

  if (verticalBand === "bottom") {
    const base = safePlayResY - marginV;
    for (let i = 0; i < lineCount; i++) {
      const offset = (lineCount - 1 - i) * step;
      positions.push(Math.round(base - offset));
    }
  } else if (verticalBand === "top") {
    for (let i = 0; i < lineCount; i++) {
      positions.push(Math.round(marginV + i * step));
    }
  } else {
    const centerY = safePlayResY / 2;
    const totalSpan = step * (lineCount - 1);
    const first = centerY - totalSpan / 2;
    for (let i = 0; i < lineCount; i++) {
      positions.push(Math.round(first + i * step));
    }
  }

  return { centerX, positions };
}

function applyCustomLineSpacing(
  lineStrings: string[],
  template: CaptionTemplate,
  playResX?: number,
  playResY?: number,
): string[] {
  if (!lineStrings.length) return [];

  const { centerX, positions } = computeLinePositions(
    lineStrings.length,
    template,
    playResX,
    playResY,
  );

  return lineStrings.map((line, idx) => {
    const targetY = positions[idx] ?? positions[positions.length - 1];
    return `{\\pos(${centerX},${Math.round(targetY)})}${line}`;
  });
}


// -----------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------


function toSrt(segs: CaptionSegment[]): string {
  return segs
    .map((segment, index) => `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text.trim()}\n`)
    .join("\n")
}

function formatSrtTimestamp(seconds: number) {
  const d = new Date(seconds * 1000)
  return d.toISOString().slice(11, 23).replace(".", ",")
}

function formatAssTimestamp(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const cs = Math.floor((seconds % 1) * 100)
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`
}

function pad(n: number) {
  return n.toString().padStart(2, "0")
}

function escapeAssText(text: string) {
  return text.replace(/\{/g, "(").replace(/\}/g, ")")
}

function chunkWordsForCenter(words: NonNullable<CaptionSegment["words"]>): NonNullable<CaptionSegment["words"]>[] {
  if (!words.length) return []

  const chunks: NonNullable<CaptionSegment["words"]>[] = []
  let currentChunk: NonNullable<CaptionSegment["words"]> = []
  let currentLineLength = 0
  let currentLines = 1
  const MAX_CHARS = 25 // Fallback for utility function

  for (const word of words) {
    const wordLen = word.text.length
    
    // Check if adding this word exceeds line length limit
    if (currentLineLength + wordLen > MAX_CHARS) {
      // If we are already at max lines, push chunk and start new
      if (currentLines >= DEFAULT_MAX_LINES_PER_CHUNK) {
        chunks.push(currentChunk)
        currentChunk = [word]
        currentLineLength = wordLen
        currentLines = 1
      } else {
        // Start new line in same chunk
        currentChunk.push(word)
        currentLineLength = wordLen
        currentLines++
      }
    } else {
      // Add to current line
      currentChunk.push(word)
      currentLineLength += wordLen + 1 // +1 for space
      
      // Check word count limit per chunk
      if (currentChunk.length >= CREATOR_KINETIC_MAX_WORDS_PER_LINE * DEFAULT_MAX_LINES_PER_CHUNK) {
        chunks.push(currentChunk)
        currentChunk = []
        currentLineLength = 0
        currentLines = 1
      }
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  // Balance orphans
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1]
    if (last.length === 1) {
      const previous = chunks[chunks.length - 2]
      if (previous.length > 1) {
        last.unshift(previous.pop()!)
      }
    }
  }

  return chunks
}

function ensureWordTimings(segments: CaptionSegment[]): CaptionSegment[] {
  return segments.map((segment) => {
    if (segment.words?.length) return segment

    const tokens = segment.text?.split(/\s+/).filter(Boolean) ?? []
    if (!tokens.length) {
      return { ...segment, words: [] }
    }

    const start = segment.start
    const end = segment.end || start + Math.max(tokens.length * 0.25, 0.5)
    const per = (end - start) / tokens.length
    let cursor = start

    const words = tokens.map((token, index) => {
      const wordStart = cursor
      const wordEnd = index === tokens.length - 1 ? end : wordStart + per
      cursor = wordEnd
      return { start: wordStart, end: wordEnd, text: token }
    })

    return { ...segment, words }
  })
}

function enforceSafeLayout(segments: CaptionSegment[], maxCharsPerLine: number): CaptionSegment[] {
  // Use a slightly tighter limit for word splitting to be safe
  const MAX_WORD_LEN = Math.max(5, maxCharsPerLine - 2)

  return segments.map((segment) => {
    if (!segment.words || segment.words.length === 0) return segment

    const newWords: SegmentWord[] = []
    let textChanged = false

    for (const word of segment.words) {
      if (word.text.length > MAX_WORD_LEN) {
        textChanged = true
        const parts = []
        for (let i = 0; i < word.text.length; i += MAX_WORD_LEN) {
          let part = word.text.slice(i, i + MAX_WORD_LEN)
          if (i + MAX_WORD_LEN < word.text.length) {
            part += "-"
          }
          parts.push(part)
        }

        const totalDur = word.end - word.start
        const totalLen = parts.reduce((sum, p) => sum + p.length, 0)
        let currentStart = word.start

        parts.forEach((part) => {
          const partDur = (part.length / totalLen) * totalDur
          newWords.push({
            text: part,
            start: currentStart,
            end: currentStart + partDur,
          })
          currentStart += partDur
        })
      } else {
        newWords.push(word)
      }
    }

    if (textChanged) {
      return {
        ...segment,
        words: newWords,
        text: newWords.map((w) => w.text).join(" "),
      }
    }

    return segment
  })
}
