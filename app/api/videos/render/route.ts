import { getDb } from "@/lib/mongodb"
import { uploadFile } from "@/lib/oracle-storage"
import { buildCaptionFile } from "@/lib/captions"
import { getCurrentUser } from "@/lib/auth"
import { buildEmojiOverlaysFromSegments } from "@/lib/emoji-overlays"
import {
  STORAGE_PREFIX,
  captionRequestSchema,
  assertEnv,
  RENDER_RESOLUTIONS,
  type CaptionSegment
} from "@/lib/pipeline"

import jwt from "jsonwebtoken"
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { ObjectId } from "mongodb"

export async function POST(request: NextRequest) {
  const db = await getDb()
  
  const user = await getCurrentUser()
  const userId = user?.userId || "default-user"

  try {
    const body = captionRequestSchema.parse(await request.json())

    // Fetch upload row
    let upload
    try {
      upload = await db.collection("uploads").findOne({
        _id: new ObjectId(body.uploadId),
        user_id: userId,
      })
    } catch (error) {
      return NextResponse.json({ error: "Invalid upload ID format" }, { status: 400 })
    }

    if (!upload) {
      console.log(`[Render] Upload not found. ID: ${body.uploadId}, User: ${userId}`)
      return NextResponse.json({ error: "Upload not found" }, { status: 404 })
    }

    // Build caption segments
    let captionSource
    try {
      captionSource = await resolveCaptionSource(db, upload._id.toString(), userId, body)
    } catch (lookupError) {
      return NextResponse.json({ error: (lookupError as Error).message }, { status: 404 })
    }

    const resolutionConfig = RENDER_RESOLUTIONS[body.resolution] || RENDER_RESOLUTIONS["1080p"]
    const finalCustomStyles = {
      ...body.customStyles,
      playResX: body.customStyles?.playResX ?? resolutionConfig.width,
      playResY: body.customStyles?.playResY ?? resolutionConfig.height,
    }

    const captionFile = buildCaptionFile(body.template, captionSource.segments, finalCustomStyles)
    const captionBuffer = Buffer.from(captionFile.content, "utf-8")

    const overlays = buildEmojiOverlaysFromSegments(captionSource.segments, finalCustomStyles)
    console.log(`[API] Generated ${overlays.length} emoji overlays`)

    const basePayload = {
      template: body.template,
      resolution: body.resolution,
      transcriptId: captionSource.transcriptId,
      translationId: captionSource.translationId,
      videoPath: upload.storage_path,
      captionPath: "",
      segmentsProvided: Boolean(body.segments?.length),
      segmentCount: captionSource.segments.length,
      overlays: overlays,
    }

    // Create job
    const jobResult = await db.collection("jobs").insertOne({
      upload_id: upload._id.toString(),
      user_id: userId,
      type: "render",
      payload: basePayload,
      status: "queued",
      created_at: new Date(),
    })

    const jobId = jobResult.insertedId.toString()

    // Upload caption file
    const captionPath = `${STORAGE_PREFIX.captions}/${upload.user_id}/${upload._id.toString()}/${jobId}.${captionFile.format}`

    await db.collection("jobs").updateOne(
      { _id: jobResult.insertedId },
      { $set: { payload: { ...basePayload, captionPath } } }
    )

    try {
      await uploadFile(
        captionPath,
        captionBuffer,
        captionFile.format === "srt" ? "text/plain" : "text/x-ass"
      )
    } catch (captionUploadError) {
      console.error("Unable to upload caption file", captionUploadError)
      await db.collection("jobs").updateOne(
        { _id: jobResult.insertedId },
        { $set: { status: "failed" } }
      )
      return NextResponse.json({ error: "Failed to store caption file" }, { status: 500 })
    }

    // Update upload status
    await db.collection("uploads").updateOne(
      { _id: upload._id },
      {
        $set: {
          status: "rendering",
          caption_asset_path: captionPath,
          updated_at: new Date(),
        }
      }
    )

    // Worker vars
    const workerUrl = assertEnv("FFMPEG_WORKER_URL", process.env.FFMPEG_WORKER_URL)
    const workerSecret = assertEnv("WORKER_JWT_SECRET", process.env.WORKER_JWT_SECRET)

    const token = jwt.sign({ jobId, uploadId: upload._id.toString() }, workerSecret, {
      expiresIn: "10m",
    })

    // overlays already computed above

    const renderPayload = {
      jobId,
      uploadId: upload._id.toString(),
      videoPath: upload.storage_path,
      captionPath,
      captionFormat: captionFile.format,
      template: body.template,
      resolution: body.resolution,
      outputPath: `${STORAGE_PREFIX.renders}/${upload.user_id}/${jobId}/rendered.mp4`,
      overlays,
    }

    // Send to worker (IMPORTANT: /render route restored)
    let workerResponse: Response
    try {
      workerResponse = await fetch(`${workerUrl}/render`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(renderPayload),
      })
    } catch (networkError) {
      console.error("Worker unreachable", networkError)

      await db.collection("jobs").updateOne(
        { _id: jobResult.insertedId },
        {
          $set: {
            status: "failed",
            error: "Worker unreachable",
          },
        },
      )

      return NextResponse.json({ error: "Unable to reach worker" }, { status: 502 })
    }

    if (!workerResponse.ok) {
      const reason = await workerResponse.text()
      console.error("Worker rejected render job", reason)

      await db.collection("jobs").updateOne(
        { _id: jobResult.insertedId },
        {
          $set: {
            status: "failed",
            error: "Worker rejected job",
          }
        }
      )

      return NextResponse.json({ error: "Worker rejected job" }, { status: 502 })
    }

    return NextResponse.json({
      jobId,
      uploadId: upload._id.toString(),
      captionPath,
      videoPath: upload.storage_path,
      outputPath: `${STORAGE_PREFIX.renders}/${upload.user_id}/${jobId}/rendered.mp4`,
      status: "queued",
    })
  } catch (error) {
    console.error("Render enqueue error", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to enqueue render" }, { status: 500 })
  }
}

// fetch transcript/translation
async function resolveCaptionSource(
  db: Awaited<ReturnType<typeof getDb>>,
  uploadId: string,
  userId: string,
  body: z.infer<typeof captionRequestSchema>,
) {

  if (body.segments?.length) {
    // If karaoke template, normalize segments for per-word timings
    if (body.template === "karaoke") {
      const normalizedSegments = body.segments.map((segment) => {
        // Always rebuild words array from text, ignore any provided words
        const tokens = segment.text?.split(/\s+/) ?? [];
        const duration = Math.max(0, Number(segment.end) - Number(segment.start));
        const perToken = tokens.length ? duration / tokens.length : 0.2;
        const words = tokens.map((token, i) => ({
          text: token,
          start: Number(segment.start) + perToken * i,
          end: Number(segment.start) + perToken * (i + 1)
        }));
        return { ...segment, words };
      });
      return {
        transcriptId: body.transcriptId ?? null,
        translationId: body.translationId ?? null,
        segments: sanitizeClientSegments(normalizedSegments),
      };
    }
    // Otherwise, normal segment handling
    return {
      transcriptId: body.transcriptId ?? null,
      translationId: body.translationId ?? null,
      segments: sanitizeClientSegments(body.segments),
    };
  }

  if (body.translationId) {
    let translation
    try {
      translation = await db.collection("translations").findOne({
        _id: new ObjectId(body.translationId),
        user_id: userId,
      })
    } catch (error) {
      throw new Error("Invalid translation ID format")
    }

    if (!translation) throw new Error("Translation not found")

    // Verify translation belongs to correct upload
    const transcript = await db.collection("transcripts").findOne({
      _id: new ObjectId(translation.transcript_id),
      upload_id: uploadId,
    })

    if (!transcript) throw new Error("Translation not found for this upload")

    return {
      transcriptId: translation.transcript_id,
      translationId: translation._id.toString(),
      segments: translation.segments as CaptionSegment[],
    }
  }

  const transcriptId = body.transcriptId ?? null
  let transcript

  if (transcriptId) {
    try {
      transcript = await db.collection("transcripts").findOne({
        _id: new ObjectId(transcriptId),
        user_id: userId,
      })
    } catch (error) {
      throw new Error("Invalid transcript ID format")
    }
  } else {
    transcript = await db.collection("transcripts")
      .find({ upload_id: uploadId, user_id: userId })
      .sort({ created_at: -1 })
      .limit(1)
      .next()
  }

  if (!transcript) throw new Error("Transcript not found")

  return {
    transcriptId: transcript._id.toString(),
    translationId: null,
    segments: transcript.segments as CaptionSegment[],
  }
}

function sanitizeClientSegments(rawSegments: NonNullable<z.infer<typeof captionRequestSchema>["segments"]>): CaptionSegment[] {
  return rawSegments.map((segment, index) => {
    const fallbackStart = index * 2
    const start = Number.isFinite(segment.start) ? Number(segment.start) : fallbackStart
    const minEnd = start + 0.2
    const endCandidate = Number.isFinite(segment.end) ? Number(segment.end) : minEnd
    const end = endCandidate > start ? endCandidate : minEnd
    const text = segment.text?.trim() ?? ""
    const words = segment.words?.map((word, wordIndex) => {
      const wordStart = Number.isFinite(word.start) ? Number(word.start) : start + wordIndex * 0.2
      const wordEndCandidate = Number.isFinite(word.end) ? Number(word.end) : wordStart + 0.2
      const wordEnd = wordEndCandidate > wordStart ? wordEndCandidate : wordStart + 0.2
      return {
        start: wordStart,
        end: wordEnd,
        text: word.text?.trim() ?? "",
      }
    })

    return {
      id: segment.id ? String(segment.id) : `segment_${index}`,
      start,
      end,
      text,
      words,
    }
  })
}
