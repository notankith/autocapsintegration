import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import jwt from "jsonwebtoken"
import { ObjectId } from "mongodb"

import { verifyIntegrationToken } from "@/lib/integration-auth"
import { integrationService } from "@/lib/integration-service"
import { getDb } from "@/lib/mongodb"
import { buildCaptionFile } from "@/lib/captions"
import { buildEmojiOverlaysFromSegments } from "@/lib/emoji-overlays"
import {
  STORAGE_PREFIX,
  RENDER_RESOLUTIONS,
  CAPTION_TEMPLATES,
  RESOLUTION_OPTIONS,
  type CaptionTemplate,
  type RenderResolution,
  assertEnv,
} from "@/lib/pipeline"
import type { IntegrationVideo } from "@/lib/types/integration"
import { uploadFile } from "@/lib/oracle-storage"

const renderRequestSchema = z.object({
  template: z.string().optional(),
  resolution: z.string().optional(),
  captionSetId: z.string().optional(),
  metadata: z.record(z.any()).optional(),
})

function normalizeTemplate(value?: string | null, fallback: CaptionTemplate = "karaoke"): CaptionTemplate {
  if (!value) return fallback
  const lower = value.toLowerCase()
  const aliases: Record<string, CaptionTemplate> = {
    modern: "minimal",
    "creator-kinetic": "karaoke",
  }
  if (aliases[lower]) {
    return aliases[lower]
  }
  return (CAPTION_TEMPLATES.find((tpl) => tpl === lower) as CaptionTemplate | undefined) ?? fallback
}

function normalizeResolution(value?: string | null, fallback: RenderResolution = "1080p"): RenderResolution {
  if (!value) return fallback
  const normalized = value.toLowerCase().replace(/p$/, "p")
  return (RESOLUTION_OPTIONS.find((res) => res === normalized) as RenderResolution | undefined) ?? fallback
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

export async function POST(request: NextRequest, context: { params: Promise<{ videoId: string }> }) {
  const token = verifyIntegrationToken(request)
  if (!token) {
    return unauthorized()
  }

  const { videoId } = await context.params
  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 })
  }

  let body: z.infer<typeof renderRequestSchema>
  try {
    body = renderRequestSchema.parse(await request.json())
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const db = await getDb()
    const videos = db.collection<IntegrationVideo>("integration_videos")
    const video = await videos.findOne({ externalVideoId: videoId })
    if (!video) {
      return NextResponse.json({ error: "Video not registered" }, { status: 404 })
    }

    if (!video.uploadId) {
      return NextResponse.json({ error: "Upload linkage missing" }, { status: 409 })
    }

    const captionSet = await integrationService.getCaptionSet(videoId)
    if (!captionSet) {
      return NextResponse.json({ error: "Caption set not ready" }, { status: 409 })
    }

    if (body.captionSetId && captionSet._id && captionSet._id.toString() !== body.captionSetId) {
      return NextResponse.json({ error: "Caption set mismatch" }, { status: 409 })
    }

    const template = normalizeTemplate(body.template ?? captionSet.template)
    const resolution = normalizeResolution(body.resolution ?? captionSet.resolution)
    const resolutionConfig = RENDER_RESOLUTIONS[resolution]

    const uploadId = new ObjectId(video.uploadId)
    const upload = await db.collection("uploads").findOne({ _id: uploadId })
    if (!upload) {
      return NextResponse.json({ error: "Upload not found" }, { status: 404 })
    }

    const finalCustomStyles = {
      playResX: resolutionConfig.width,
      playResY: resolutionConfig.height,
    }

    const captionFile = buildCaptionFile(template, captionSet.segments, finalCustomStyles)
    const captionBuffer = Buffer.from(captionFile.content, "utf-8")

    const overlays = buildEmojiOverlaysFromSegments(captionSet.segments, finalCustomStyles)
    console.log(`[Integration Render] Generated ${overlays.length} overlays for ${videoId}`)

    const basePayload = {
      template,
      resolution,
      transcriptId: captionSet.transcriptId,
      translationId: null,
      videoPath: upload.storage_path,
      captionPath: "",
      segmentsProvided: true,
      segmentCount: captionSet.segments.length,
      overlays,
      integrationVideoId: video.externalVideoId,
      metadata: body.metadata,
    }

    const jobResult = await db.collection("jobs").insertOne({
      upload_id: upload._id.toString(),
      user_id: upload.user_id,
      type: "render",
      payload: basePayload,
      status: "queued",
      created_at: new Date(),
    })

    const jobId = jobResult.insertedId.toString()
    const captionPath = `${STORAGE_PREFIX.captions}/${upload.user_id}/${upload._id.toString()}/${jobId}.${captionFile.format}`

    await db.collection("jobs").updateOne(
      { _id: jobResult.insertedId },
      { $set: { payload: { ...basePayload, captionPath } } },
    )

    try {
      await uploadFile(
        captionPath,
        captionBuffer,
        captionFile.format === "srt" ? "text/plain" : "text/x-ass",
      )
    } catch (error) {
      console.error("[Integration Render] Failed to upload caption file", error)
      await db.collection("jobs").updateOne(
        { _id: jobResult.insertedId },
        { $set: { status: "failed", error: "CAPTION_UPLOAD_FAILED" } },
      )
      return NextResponse.json({ error: "Failed to upload caption file" }, { status: 500 })
    }

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

    const workerUrl = assertEnv("FFMPEG_WORKER_URL", process.env.FFMPEG_WORKER_URL)
    const workerSecret = assertEnv("WORKER_JWT_SECRET", process.env.WORKER_JWT_SECRET)

    const tokenPayload = jwt.sign({ jobId, uploadId: upload._id.toString() }, workerSecret, {
      expiresIn: "10m",
    })

    const renderPayload = {
      jobId,
      uploadId: upload._id.toString(),
      videoPath: upload.storage_path,
      captionPath,
      captionFormat: captionFile.format,
      template,
      resolution,
      outputPath: `${STORAGE_PREFIX.renders}/${upload.user_id}/${jobId}/rendered.mp4`,
      overlays,
      integrationVideoId: video.externalVideoId,
    }

    const workerResponse = await fetch(`${workerUrl}/render`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenPayload}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(renderPayload),
    })

    if (!workerResponse.ok) {
      const reason = await workerResponse.text()
      console.error("[Integration Render] Worker rejected job", reason)
      await db.collection("jobs").updateOne(
        { _id: jobResult.insertedId },
        {
          $set: {
            status: "failed",
            error: "WORKER_REJECTED",
          },
        },
      )
      return NextResponse.json({ error: "Worker rejected job" }, { status: 502 })
    }

    await integrationService.linkRenderJob(video.externalVideoId, jobId, {
      template,
      resolution,
      metadata: body.metadata,
    })

    integrationService.sendRenderProgressCallback(video.externalVideoId, 0).catch((error) => {
      console.warn("[Integration Render] Unable to emit initial progress", error)
    })

    return NextResponse.json({
      jobId,
      uploadId: upload._id.toString(),
      captionPath,
      videoPath: upload.storage_path,
      outputPath: renderPayload.outputPath,
      status: "queued",
    })
  } catch (error) {
    console.error("[Integration Render] Failed", error)
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 })
    }
    return NextResponse.json({ error: "Failed to start render" }, { status: 500 })
  }
}
