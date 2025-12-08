// AutoCaps - Integration Service
// Location: AutoCapsPersonal/lib/integration-service.ts

import crypto from "crypto"
import { ObjectId } from "mongodb"
import { getDb } from "./mongodb"
import { uploadFile } from "./oracle-storage"
import { STORAGE_PREFIX, type CaptionSegment } from "@/lib/pipeline"
import type {
  CaptionSetDocument,
  CaptionSetPayloadSegment,
  IntegrationCallbackPayload,
  IntegrationVideo,
  IntegrationWorkflowStatus,
} from "./types/integration"

const INTEGRATION_SECRET = process.env.INTEGRATION_JWT_SECRET!
const CAPTION_COLLECTION = "integration_captions"
const VIDEO_COLLECTION = "integration_videos"
const MS_IN_SECOND = 1000
const CREATOR_KINETIC_TEMPLATE = "creator-kinetic"
function ensureCreatorKineticTemplate(value?: string | null) {
  const normalized = value?.toLowerCase()
  if (!normalized) return CREATOR_KINETIC_TEMPLATE
  if (normalized === CREATOR_KINETIC_TEMPLATE || normalized === "karaoke") {
    return CREATOR_KINETIC_TEMPLATE
  }
  return CREATOR_KINETIC_TEMPLATE
}

const now = () => new Date()

function sanitizeFilename(value: string) {
  return value.replace(/[^a-zA-Z0-9_.\/-]/g, "_")
}

async function mirrorExternalVideo(
  externalUrl: string,
  externalVideoId: string,
  metadata?: Record<string, any>,
): Promise<{ url: string; path: string } | null> {
  try {
    const response = await fetch(externalUrl)
    if (!response.ok) {
      throw new Error(`Mirror download failed: ${response.status}`)
    }

    const contentType = response.headers.get("content-type") ?? undefined
    const buffer = Buffer.from(await response.arrayBuffer())

    const extFromName = metadata?.fileName?.match(/\.([a-zA-Z0-9]+)$/)?.[1]
    const extFromUrl = externalUrl.match(/\.([a-zA-Z0-9]+)(?:$|[?#])/i)?.[1]
    const extension = (extFromName ?? extFromUrl ?? "mp4").toLowerCase()
    const safeBaseName = sanitizeFilename(metadata?.fileName ?? `integration-${externalVideoId}.${extension}`)
    const objectPath = `${STORAGE_PREFIX.uploads}/integration/${externalVideoId}/${Date.now()}-${safeBaseName}`

    return uploadFile(objectPath, buffer, contentType)
  } catch (error) {
    console.warn(`[Integration] Failed to mirror video ${externalVideoId}`, error)
    return null
  }
}

function msToSeconds(ms: number): number {
  return Math.max(0, Number((ms / MS_IN_SECOND).toFixed(3)))
}

function secondsToMs(seconds: number): number {
  return Math.max(0, Math.round(seconds * MS_IN_SECOND))
}

function normalizeSegmentsFromMs(segments: CaptionSetPayloadSegment[]): CaptionSegment[] {
  return segments.map((segment, index) => {
    const safeStartMs = Number.isFinite(segment.startMs) ? Number(segment.startMs) : index * 2000
    const rawEndMs = Number.isFinite(segment.endMs) ? Number(segment.endMs) : safeStartMs + 800
    const startMs = Math.max(0, Math.min(safeStartMs, rawEndMs))
    const minEndMs = startMs + 200
    const endMs = Math.max(minEndMs, rawEndMs)
    const text = segment.text?.trim() ?? ""

    const words = (segment.words ?? []).map((word, wordIndex) => {
      const wStartMs = Number.isFinite(word.startMs) ? Number(word.startMs) : startMs + wordIndex * 120
      const rawWEndMs = Number.isFinite(word.endMs) ? Number(word.endMs) : wStartMs + 120
      const wEndMs = Math.max(wStartMs + 60, rawWEndMs)
      return {
        text: word.text?.trim() ?? "",
        start: msToSeconds(Math.max(startMs, wStartMs)),
        end: msToSeconds(Math.min(endMs, wEndMs)),
      }
    })

    return {
      id: segment.id ?? `segment_${index}`,
      start: msToSeconds(startMs),
      end: msToSeconds(endMs),
      text,
      words: words.length ? words : undefined,
    }
  })
}

function convertSegmentsToMsPayload(segments: CaptionSegment[]) {
  return segments.map((segment, index) => ({
    id: segment.id ?? `segment_${index}`,
    text: segment.text ?? "",
    startMs: secondsToMs(segment.start ?? 0),
    endMs: secondsToMs(segment.end ?? 0),
    words: segment.words?.map((word) => ({
      text: word.text ?? "",
      startMs: secondsToMs(word.start ?? segment.start ?? 0),
      endMs: secondsToMs(word.end ?? word.start ?? segment.end ?? 0),
    })),
  }))
}

export class IntegrationService {
  private signPayload(payload: unknown): string {
    return crypto.createHmac("sha256", INTEGRATION_SECRET).update(JSON.stringify(payload)).digest("hex")
  }

  private async sendCallback(url: string, payload: IntegrationCallbackPayload, maxRetries = 3): Promise<boolean> {
    const signature = this.signPayload(payload)

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signature": signature,
          },
          body: JSON.stringify(payload),
        })

        if (response.ok) {
          console.log(`[Integration] Callback success to ${url}`)
          return true
        }

        console.warn(`[Integration] Callback failed (${response.status}) attempt ${attempt + 1}`)
      } catch (error) {
        console.error(`[Integration] Callback error attempt ${attempt + 1}`, error)
      }

      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      }
    }

    return false
  }

  private async getVideoOrThrow(externalVideoId: string): Promise<IntegrationVideo> {
    const db = await getDb()
    const doc = await db.collection<IntegrationVideo>(VIDEO_COLLECTION).findOne({ externalVideoId })
    if (!doc) {
      throw new Error(`Integration video not found: ${externalVideoId}`)
    }
    return doc
  }

  private async updateVideo(externalVideoId: string, patch: Partial<IntegrationVideo>) {
    const db = await getDb()
    await db.collection<IntegrationVideo>(VIDEO_COLLECTION).updateOne(
      { externalVideoId },
      { $set: { ...patch, updatedAt: now() } },
    )
  }

  private async appendHistory(externalVideoId: string, status: IntegrationWorkflowStatus, note?: string) {
    const db = await getDb()
    await db.collection<IntegrationVideo>(VIDEO_COLLECTION).updateOne(
      { externalVideoId },
      {
        $set: { status, updatedAt: now() },
        $push: {
          workflowHistory: {
            status,
            at: now(),
            ...(note ? { note } : {}),
          },
        },
      },
    )
  }

  async registerVideo(params: {
    externalVideoId: string
    contentId: string
    portalId: string
    videoUrl: string
    transcriptionCallbackUrl: string
    renderCallbackUrl: string
    metadata?: Record<string, any>
  }): Promise<IntegrationVideo> {
    const db = await getDb()
    const existing = await db.collection<IntegrationVideo>(VIDEO_COLLECTION).findOne({ externalVideoId: params.externalVideoId })

    let videoUrlToStore = params.videoUrl
    let videoStoragePath: string | undefined
    const shouldRefreshMirror = existing && params.videoUrl !== existing.originalVideoUrl

    if (!existing?.video_storage_path || shouldRefreshMirror) {
      const mirrored = await mirrorExternalVideo(params.videoUrl, params.externalVideoId, params.metadata)
      if (mirrored) {
        videoUrlToStore = mirrored.url
        videoStoragePath = mirrored.path
      }
    } else {
      videoStoragePath = existing.video_storage_path
      videoUrlToStore = existing.videoUrl
    }

    const mergedMetadata = {
      ...(existing?.metadata ?? {}),
      ...(params.metadata ?? {}),
      originalVideoUrl: params.videoUrl,
    }

    const base: IntegrationVideo = {
      externalVideoId: params.externalVideoId,
      externalSystem: "content_scheduler",
      contentId: params.contentId,
      portalId: params.portalId,
      videoUrl: videoUrlToStore,
      video_storage_path: videoStoragePath,
      originalVideoUrl: params.videoUrl,
      transcriptionCallbackUrl: params.transcriptionCallbackUrl,
      renderCallbackUrl: params.renderCallbackUrl,
      metadata: mergedMetadata,
      status: "pending_transcription",
      workflowHistory: [
        {
          status: "pending_transcription",
          at: now(),
          note: "Video registered",
        },
      ],
      callbackAttempts: 0,
      createdAt: now(),
      updatedAt: now(),
    }

    if (existing) {
      await db.collection(VIDEO_COLLECTION).updateOne(
        { externalVideoId: params.externalVideoId },
        {
          $set: {
            contentId: params.contentId,
            portalId: params.portalId,
            videoUrl: videoUrlToStore,
            video_storage_path: videoStoragePath ?? existing.video_storage_path,
            transcriptionCallbackUrl: params.transcriptionCallbackUrl,
            renderCallbackUrl: params.renderCallbackUrl,
            metadata: mergedMetadata,
            updatedAt: now(),
          },
        },
      )
      return this.getVideoOrThrow(params.externalVideoId)
    }

    const insertResult = await db.collection(VIDEO_COLLECTION).insertOne(base)
    console.log(`[Integration] Registered video ${params.externalVideoId}`)
    return { ...base, _id: insertResult.insertedId }
  }

  async updateStatus(externalVideoId: string, status: IntegrationWorkflowStatus, note?: string) {
    await this.appendHistory(externalVideoId, status, note)
  }

  async linkTranscription(
    externalVideoId: string,
    data: { uploadId: string; transcriptId: string; transcriptionJobId?: string },
  ) {
    const patch: Partial<IntegrationVideo> = {
      uploadId: data.uploadId,
      transcriptId: data.transcriptId,
    }

    if (data.transcriptionJobId) {
      patch.transcriptionJobId = data.transcriptionJobId
    }

    await this.updateVideo(externalVideoId, patch)
    await this.updateStatus(externalVideoId, "transcribing")
    console.log(`[Integration] Linked transcription ${data.transcriptId} to ${externalVideoId}`)
  }

  async ensureCaptionDraft(
    externalVideoId: string,
    payload: { transcriptId: string; segments: CaptionSegment[]; template?: string },
  ): Promise<CaptionSetDocument> {
    const db = await getDb()
    const video = await this.getVideoOrThrow(externalVideoId)
    const captions = db.collection<CaptionSetDocument>(CAPTION_COLLECTION)

    if (video.captionSetId) {
      const existing = await captions.findOne({ _id: new ObjectId(video.captionSetId) })
      if (existing) {
        return existing
      }
    }

    const doc: CaptionSetDocument = {
      videoId: video.externalVideoId,
      contentId: video.contentId,
      portalId: video.portalId,
      transcriptId: payload.transcriptId,
      segments: payload.segments,
      status: "draft",
      version: 1,
      template: ensureCreatorKineticTemplate(payload.template),
      createdAt: now(),
      updatedAt: now(),
    }

    const result = await captions.insertOne(doc)
    await this.updateVideo(externalVideoId, { captionSetId: result.insertedId.toString() })
    return { ...doc, _id: result.insertedId }
  }

  async saveCaptionSet(
    externalVideoId: string,
    segments: CaptionSetPayloadSegment[],
    options?: { status?: "draft" | "approved"; template?: string; resolution?: string; metadata?: Record<string, any> }
  ): Promise<CaptionSetDocument> {
    const db = await getDb()
    const video = await this.getVideoOrThrow(externalVideoId)
    const captions = db.collection<CaptionSetDocument>(CAPTION_COLLECTION)
    const normalizedSegments = normalizeSegmentsFromMs(segments)
    const status = options?.status ?? "draft"

    const template = ensureCreatorKineticTemplate(options?.template)

    if (video.captionSetId) {
      const result = await captions.findOneAndUpdate(
        { _id: new ObjectId(video.captionSetId) },
        {
          $set: {
            segments: normalizedSegments,
            status,
            template,
            resolution: options?.resolution ?? undefined,
            metadata: options?.metadata ?? undefined,
            updatedAt: now(),
          },
          $inc: { version: 1 },
        },
        { returnDocument: "after" },
      )
      if (result) {
        return result
      }
    }

    const doc: CaptionSetDocument = {
      videoId: video.externalVideoId,
      contentId: video.contentId,
      portalId: video.portalId,
      transcriptId: video.transcriptId,
      segments: normalizedSegments,
      status,
      version: 1,
      template,
      resolution: options?.resolution,
      metadata: options?.metadata,
      createdAt: now(),
      updatedAt: now(),
    }

    const insert = await captions.insertOne(doc)
    await this.updateVideo(externalVideoId, { captionSetId: insert.insertedId.toString() })
    return { ...doc, _id: insert.insertedId }
  }

  async getCaptionSet(externalVideoId: string): Promise<CaptionSetDocument | null> {
    const video = await this.getVideoOrThrow(externalVideoId)
    if (!video.captionSetId) return null
    const db = await getDb()
    return db.collection<CaptionSetDocument>(CAPTION_COLLECTION).findOne({ _id: new ObjectId(video.captionSetId) })
  }

  async getCaptionSetAsMs(externalVideoId: string) {
    const captionSet = await this.getCaptionSet(externalVideoId)
    if (!captionSet) return null
    return {
      ...captionSet,
      segmentsMs: convertSegmentsToMsPayload(captionSet.segments),
    }
  }

  async sendTranscriptionCallback(externalVideoId: string) {
    const video = await this.getVideoOrThrow(externalVideoId)

    const payload: IntegrationCallbackPayload = {
      contentId: video.contentId,
      portalId: video.portalId,
      videoId: video.externalVideoId,
      status: "awaiting_approval",
      transcriptionJobId: video.transcriptionJobId,
      transcriptId: video.transcriptId,
      captionSetId: video.captionSetId,
    }

    const success = await this.sendCallback(video.transcriptionCallbackUrl, payload)
    await this.updateVideo(externalVideoId, {
      callbackAttempts: (video.callbackAttempts ?? 0) + 1,
      lastCallbackAt: now(),
    })

    if (!success) {
      await this.updateStatus(externalVideoId, "failed", "Transcription callback failed")
      throw new Error("Failed to send transcription callback")
    }

    await this.updateStatus(externalVideoId, "awaiting_approval")
  }

  async linkRenderJob(externalVideoId: string, jobId: string, renderOptions?: any) {
    await this.updateVideo(externalVideoId, {
      renderJobId: jobId,
      renderOptions,
    })
    await this.updateStatus(externalVideoId, "rendering")
    console.log(`[Integration] Linked render job ${jobId} to ${externalVideoId}`)
  }

  async sendRenderProgressCallback(externalVideoId: string, progress: number) {
    const video = await this.getVideoOrThrow(externalVideoId)
    if (!video.renderJobId) {
      return
    }

    const payload: IntegrationCallbackPayload = {
      contentId: video.contentId,
      portalId: video.portalId,
      videoId: video.externalVideoId,
      status: "rendering",
      renderJobId: video.renderJobId,
      progress,
    }

    await this.sendCallback(video.renderCallbackUrl, payload)
  }

  async sendRenderCompleteCallback(externalVideoId: string) {
    const video = await this.getVideoOrThrow(externalVideoId)
    if (!video.renderJobId) {
      throw new Error(`Render job not linked for ${externalVideoId}`)
    }

    const db = await getDb()
    const job = await db.collection("jobs").findOne({ _id: new ObjectId(video.renderJobId) })
    if (!job || job.status !== "done") {
      throw new Error(`Render job not completed: ${video.renderJobId}`)
    }

    const renderedVideoUrl = job.result?.downloadUrl || ""

    const payload: IntegrationCallbackPayload = {
      contentId: video.contentId,
      portalId: video.portalId,
      videoId: video.externalVideoId,
      status: "captioned",
      renderJobId: video.renderJobId,
      renderedVideoUrl,
      captionSetId: video.captionSetId,
    }

    const success = await this.sendCallback(video.renderCallbackUrl, payload)
    await this.updateVideo(externalVideoId, {
      callbackAttempts: (video.callbackAttempts ?? 0) + 1,
      lastCallbackAt: now(),
      captionedUrl: renderedVideoUrl,
    })

    if (!success) {
      await this.updateStatus(externalVideoId, "failed", "Render callback failed")
      throw new Error("Failed to send render completion callback")
    }

    await this.updateStatus(externalVideoId, "captioned")
  }

  async sendErrorCallback(
    externalVideoId: string,
    type: "transcription" | "render",
    error: Error,
  ) {
    const video = await this.getVideoOrThrow(externalVideoId)

    const payload: IntegrationCallbackPayload = {
      contentId: video.contentId,
      portalId: video.portalId,
      videoId: video.externalVideoId,
      status: "failed",
      transcriptionJobId: video.transcriptionJobId,
      transcriptId: video.transcriptId,
      renderJobId: video.renderJobId,
      error: {
        message: error.message,
        code: type === "transcription" ? "TRANSCRIPTION_FAILED" : "RENDER_FAILED",
      },
    }

    const callbackUrl = type === "transcription" ? video.transcriptionCallbackUrl : video.renderCallbackUrl
    await this.sendCallback(callbackUrl, payload, 2)
    await this.updateStatus(externalVideoId, "failed", error.message)
  }
}

export const integrationService = new IntegrationService()
