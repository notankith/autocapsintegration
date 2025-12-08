// AutoCaps - Integration Types
// Location: AutoCapsPersonal/lib/types/integration.ts

import type { CaptionSegment } from "@/lib/pipeline"

export type IntegrationWorkflowStatus =
  | "received"
  | "pending_transcription"
  | "transcribing"
  | "awaiting_approval"
  | "approved_rendering"
  | "rendering"
  | "captioned"
  | "failed"

export interface IntegrationVideo {
  _id?: any
  externalVideoId: string
  contentId: string
  portalId: string
  externalSystem: "content_scheduler"

  // AutoCaps IDs
  uploadId?: string
  transcriptId?: string
  transcriptionJobId?: string
  renderJobId?: string
  captionSetId?: string

  // URLs
  videoUrl: string
  video_storage_path?: string
  originalVideoUrl?: string
  captionedUrl?: string

  // Callback targets
  transcriptionCallbackUrl: string
  renderCallbackUrl: string
  callbackAttempts: number
  lastCallbackAt?: Date

  // Status
  status: IntegrationWorkflowStatus
  workflowHistory: Array<{
    status: IntegrationWorkflowStatus
    at: Date
    note?: string
  }>

  metadata?: Record<string, any>
  renderOptions?: any

  // Error tracking
  error?: {
    message: string
    code: string
    occurredAt: Date
  }

  createdAt: Date
  updatedAt: Date
}

export interface CaptionSetDocument {
  _id?: any
  videoId: string
  contentId: string
  portalId: string
  transcriptId?: string
  segments: CaptionSegment[]
  status: "draft" | "approved"
  version: number
  template?: string
  resolution?: string
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface CaptionSetPayloadSegment {
  id?: string
  startMs: number
  endMs: number
  text: string
  words?: Array<{ text: string; startMs: number; endMs: number }>
}

export interface TranscribeRequest {
  videoId: string
  contentId: string
  portalId: string
  videoUrl: string
  callbackUrls: {
    transcription: string
    render: string
  }
  metadata?: Record<string, any>
}

export interface UpdateTranscriptionRequest {
  videoId: string
  transcriptionId: string
  correctedSegments: CaptionSetPayloadSegment[]
}

export interface RenderRequest {
  videoId: string
  contentId: string
  portalId: string
  callbackUrl?: string
  captionSetId?: string
  segments?: CaptionSetPayloadSegment[]
  template?: string
  resolution?: string
  metadata?: Record<string, any>
}

export interface IntegrationCallbackPayload {
  contentId: string
  portalId: string
  videoId: string
  status: IntegrationWorkflowStatus
  transcriptionJobId?: string
  transcriptId?: string
  renderJobId?: string
  progress?: number
  captionSetId?: string
  renderedVideoUrl?: string
  error?: {
    message: string
    code?: string
  }
}
