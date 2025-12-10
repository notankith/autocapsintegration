import "dotenv/config"
import { ObjectId } from "mongodb"
import crypto from "crypto"
import jwt from "jsonwebtoken"
import { getDb } from "../lib/mongodb"
import { buildCaptionFile } from "../lib/captions"
import { buildEmojiOverlaysFromSegments } from "../lib/emoji-overlays"
import { uploadFile } from "../lib/oracle-storage"
import {
  STORAGE_PREFIX,
  RENDER_RESOLUTIONS,
  type CaptionSegment,
} from "../lib/pipeline"

async function fetchLatestTranscript(
  db: Awaited<ReturnType<typeof getDb>>,
  uploadId: string,
  userId: string,
) {
  const transcript = await db
    .collection("transcripts")
    .find({ upload_id: uploadId, user_id: userId })
    .sort({ created_at: -1 })
    .limit(1)
    .next()

  if (!transcript) {
    throw new Error(`No transcript found for upload ${uploadId}`)
  }

  return transcript as { _id: ObjectId; segments: CaptionSegment[] }
}

export async function createAndTriggerJob(uploadId: string, options?: { segments?: CaptionSegment[]; customStyles?: any; transcriptId?: string }) {
  const db = await getDb()
  const upload = await db.collection("uploads").findOne({ _id: new ObjectId(uploadId) })
  if (!upload) {
    throw new Error(`Upload ${uploadId} not found`)
  }

  const userId = upload.user_id || "default-user"

  // Allow client-provided segments (live editor) to be used instead of DB transcript
  let segments: CaptionSegment[]
  let transcriptId: string | null = null
  if (options && Array.isArray(options.segments) && options.segments.length > 0) {
    segments = options.segments as CaptionSegment[]
    transcriptId = options.transcriptId ?? null
  } else {
    const transcript = await fetchLatestTranscript(db, uploadId, userId)
    segments = transcript.segments as CaptionSegment[]
    transcriptId = transcript._id.toString()
  }

  const resolutionConfig = RENDER_RESOLUTIONS["1080p"]
  const customStyles = options?.customStyles ?? {
    playResX: resolutionConfig.width,
    playResY: resolutionConfig.height,
  }

  const captionFile = buildCaptionFile("karaoke", segments, customStyles)
  const captionBuffer = Buffer.from(captionFile.content, "utf-8")
  const overlays = buildEmojiOverlaysFromSegments(segments, customStyles)

  // Compute a deterministic hash of the caption file so we can detect
  // whether a previous render already used the same captions.
  const captionHash = crypto.createHash("sha256").update(captionFile.content, "utf8").digest("hex")

  const basePayload = {
    template: "karaoke" as const,
    resolution: "1080p" as const,
    transcriptId: transcriptId,
    translationId: null,
    videoPath: upload.storage_path,
    captionPath: "",
    segmentsProvided: true,
    segmentCount: segments.length,
    overlays,
  }

  // If we already have a rendered asset and the caption hash matches,
  // skip creating a new render job and reuse the last render.
  if (upload.render_asset_path && upload.render_caption_hash && upload.render_caption_hash === captionHash) {
    console.log(`Skipping render for upload ${uploadId}; existing rendered asset matches caption hash.`)
    return {
      skipped: true,
      renderedPath: upload.render_asset_path,
      renderedUrl: null,
      captionHash,
    }
  }

  const jobResult = await db.collection("jobs").insertOne({
    upload_id: upload._id.toString(),
    user_id: userId,
    type: "render",
    payload: basePayload,
    status: "queued",
    created_at: new Date(),
  })

  const jobId = jobResult.insertedId.toString()
  const captionPath = `${STORAGE_PREFIX.captions}/${userId}/${upload._id.toString()}/${jobId}.${captionFile.format}`

  await db.collection("jobs").updateOne(
    { _id: jobResult.insertedId },
    { $set: { payload: { ...basePayload, captionPath } } },
  )

  await uploadFile(
    captionPath,
    captionBuffer,
    captionFile.format === "srt" ? "text/plain" : "text/x-ass",
  )

  await db.collection("uploads").updateOne(
    { _id: upload._id },
    {
      $set: {
        status: "rendering",
        caption_asset_path: captionPath,
        updated_at: new Date(),
      },
    },
  )

  const workerUrl = process.env.FFMPEG_WORKER_URL
  const workerSecret = process.env.WORKER_JWT_SECRET

  if (!workerUrl || !workerSecret) {
    throw new Error("Worker configuration missing")
  }

  const token = jwt.sign({ jobId, uploadId }, workerSecret, { expiresIn: "10m" })

  const renderPayload = {
    jobId,
    uploadId,
    videoPath: upload.storage_path,
    captionPath,
    captionFormat: captionFile.format,
    template: "karaoke",
    resolution: "1080p",
    outputPath: `${STORAGE_PREFIX.renders}/${userId}/${jobId}/rendered.mp4`,
    overlays,
  }

  const workerResponse = await fetch(`${workerUrl}/render`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(renderPayload),
  })

  if (!workerResponse.ok) {
    const reason = await workerResponse.text()
    await db.collection("jobs").updateOne(
      { _id: jobResult.insertedId },
      { $set: { status: "failed", error: reason } },
    )
    throw new Error(`Worker rejected job: ${reason}`)
  }

  console.log("Queued job", {
    jobId,
    captionPath,
    outputPath: renderPayload.outputPath,
  })

  return { jobId, captionPath, outputPath: renderPayload.outputPath }
}

async function main() {
  const uploadId = process.argv[2]
  if (!uploadId) {
    console.error("Usage: tsx scripts/trigger-render.ts <uploadId>")
    process.exit(1)
  }

  try {
    await createAndTriggerJob(uploadId)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}
