import { getDb } from "@/lib/mongodb"
import { getCurrentUser } from "@/lib/auth"
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { ObjectId } from "mongodb"

const wordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
})

const segmentSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  start: z.number().optional(),
  end: z.number().optional(),
  text: z.string(),
  words: z.array(wordSchema).optional(),
})

const requestSchema = z.object({
  text: z.string().trim().min(1, "Transcript text is required"),
  language: z.string().min(2).optional(),
  segments: z.array(segmentSchema).optional(),
})

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const db = await getDb()

  try {
    const body = requestSchema.parse(await request.json())
    const user = await getCurrentUser()
    const userId = user?.userId || "default-user"

    const { id: transcriptId } = await context.params

    if (!ObjectId.isValid(transcriptId)) {
      return NextResponse.json({ error: "Invalid transcript ID" }, { status: 400 })
    }

    const transcript = await db.collection("transcripts").findOne({
      _id: new ObjectId(transcriptId),
      user_id: userId,
    })

    if (!transcript) {
      return NextResponse.json({ error: "Transcript not found" }, { status: 404 })
    }

    const normalizedSegments = normalizeSegments(body.segments, body.text)
    const flattenedWords = normalizedSegments.flatMap((segment) => segment.words ?? [])

    const updateResult = await db.collection("transcripts").findOneAndUpdate(
      { _id: new ObjectId(transcriptId) },
      {
        $set: {
          text: body.text,
          source_language: body.language ?? transcript.source_language,
          segments: normalizedSegments,
          words: flattenedWords,
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" }
    )

    if (!updateResult) {
      return NextResponse.json({ error: "Could not update transcript" }, { status: 500 })
    }

    const updatedTranscript = updateResult

    await db.collection("uploads").updateOne(
      { _id: new ObjectId(transcript.upload_id) },
      {
        $set: {
          latest_transcript_id: transcriptId,
          updated_at: new Date(),
        },
      }
    )

    return NextResponse.json({
      transcript: {
        ...updatedTranscript,
        id: updatedTranscript._id.toString(),
      },
    })
  } catch (error) {
    console.error("Transcript update error", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to update transcript" }, { status: 500 })
  }
}

function normalizeSegments(
  segments: z.infer<typeof requestSchema>["segments"],
  fallbackText: string,
) {
  const source = segments?.length ? segments : buildSegmentsFromFallbackText(fallbackText)

  return source.map((segment, index) => {
    const start = Number.isFinite(segment.start) ? Number(segment.start) : index * 2
    const duration = Math.max(Number(segment.end) - start, Math.max(segment.text.length / 10, 1.2))
    const end = Number.isFinite(segment.end) && Number(segment.end) > start ? Number(segment.end) : start + duration
    const text = segment.text.trim()

    return {
      id: segment.id ? String(segment.id) : `segment_${index}`,
      start,
      end,
      text,
      words: segment.words?.length ? segment.words : distributeWordsEvenly(text, start, end),
    }
  })
}

function buildSegmentsFromFallbackText(text: string) {
  const cleaned = text.trim()
  if (!cleaned) {
    return [
      {
        id: "segment_0",
        start: 0,
        end: 2,
        text: "",
      },
    ]
  }

  const sentences = cleaned.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean)
  if (!sentences.length) {
    return [
      {
        id: "segment_0",
        start: 0,
        end: Math.max(cleaned.length / 8, 2),
        text: cleaned,
      },
    ]
  }

  return sentences.map((sentence, index) => ({
    id: `segment_${index}`,
    start: index * 2,
    end: index * 2 + Math.max(sentence.length / 8, 1.5),
    text: sentence,
  }))
}

function distributeWordsEvenly(text: string, start: number, end: number) {
  const tokens = text.split(/\s+/).map((token) => token.trim()).filter(Boolean)
  if (!tokens.length) {
    return []
  }

  const duration = end > start ? end - start : Math.max(tokens.length * 0.25, 0.5)
  const perWord = duration / tokens.length
  let cursor = start

  return tokens.map((token, index) => {
    const wordStart = cursor
    const wordEnd = index === tokens.length - 1 ? start + duration : wordStart + perWord
    cursor = wordEnd
    return {
      start: wordStart,
      end: wordEnd,
      text: token,
    }
  })
}
