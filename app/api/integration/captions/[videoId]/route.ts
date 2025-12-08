import { NextRequest, NextResponse } from "next/server"
import { verifyIntegrationToken } from "@/lib/integration-auth"
import { integrationService } from "@/lib/integration-service"
import type { CaptionSetPayloadSegment } from "@/lib/types/integration"

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

export async function GET(request: NextRequest, context: { params: Promise<{ videoId: string }> }) {
  if (!verifyIntegrationToken(request)) {
    return unauthorized()
  }

  const { videoId } = await context.params
  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 })
  }

  try {
    const captionSet = await integrationService.getCaptionSetAsMs(videoId)
    if (!captionSet) {
      return NextResponse.json({ error: "Caption set not found" }, { status: 404 })
    }

    return NextResponse.json({
      videoId,
      captionSetId: captionSet._id ? captionSet._id.toString() : null,
      transcriptId: captionSet.transcriptId,
      status: captionSet.status,
      version: captionSet.version,
      template: captionSet.template,
      resolution: captionSet.resolution,
      segments: captionSet.segmentsMs,
      updatedAt: captionSet.updatedAt,
    })
  } catch (error) {
    console.error("[Integration/Captions] GET error", error)
    return NextResponse.json({ error: "Failed to load caption set" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ videoId: string }> }) {
  if (!verifyIntegrationToken(request)) {
    return unauthorized()
  }

  const { videoId } = await context.params
  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId" }, { status: 400 })
  }

  let body: { segments?: CaptionSetPayloadSegment[]; status?: string; template?: string; resolution?: string; metadata?: Record<string, any> }
  try {
    body = await request.json()
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!Array.isArray(body.segments) || body.segments.length === 0) {
    return NextResponse.json({ error: "segments array is required" }, { status: 400 })
  }

  try {
    await integrationService.saveCaptionSet(videoId, body.segments, {
      status: body.status === "approved" ? "approved" : "draft",
      template: body.template,
      resolution: body.resolution,
      metadata: body.metadata,
    })

    const captionSet = await integrationService.getCaptionSetAsMs(videoId)
    if (!captionSet) {
      return NextResponse.json({ error: "Caption set not available after save" }, { status: 404 })
    }

    return NextResponse.json({
      videoId,
      captionSetId: captionSet._id ? captionSet._id.toString() : null,
      transcriptId: captionSet.transcriptId,
      status: captionSet.status,
      version: captionSet.version,
      template: captionSet.template,
      resolution: captionSet.resolution,
      segments: captionSet.segmentsMs,
      updatedAt: captionSet.updatedAt,
    })
  } catch (error) {
    console.error("[Integration/Captions] PUT error", error)
    return NextResponse.json({ error: "Failed to save caption set" }, { status: 500 })
  }
}
