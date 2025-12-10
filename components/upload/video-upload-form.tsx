"use client"

import type React from "react"

import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertCircle, CheckCircle, Loader, Upload } from "lucide-react"
import { useRouter } from "next/navigation"

type UploadPreparation = {
  uploadId: string
  uploadUrl: string
  path: string
  // Optional fields (backward compatibility)
  token?: string
  bucket?: string
}

type TranscriptionResult = {
  transcriptId?: string
  jobId?: string
}

interface VideoUploadFormProps {
  onComplete?: (result: { uploadId: string; transcriptId?: string }) => void
}

export function VideoUploadForm({ onComplete }: VideoUploadFormProps = {}) {
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      if (selectedFile.size > 2 * 1024 * 1024 * 1024) {
        setError("File size must be less than 2GB")
        return
      }
      setFile(selectedFile)
      setError(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !description.trim()) {
      setError("Please select a video and enter a video description")
      return
    }

    setIsLoading(true)
    setError(null)
    setStatusMessage("Preparing upload...")
    setSuccessMessage(null)
    setUploadProgress(0)

    try {
      const prepared = await prepareSignedUpload(file, description)
      setStatusMessage("Uploading to Oracle Object Storage...")
      await uploadFileWithProgress(
        prepared,
        file,
        (progress) => setUploadProgress(Math.min(progress, 99)),
      )
      setStatusMessage("Transcribing with AssemblyAI...")
      const transcription = await startTranscription(prepared.uploadId, undefined, {
        useMocks: USE_MOCK_TRANSCRIPTION,
      })

      setUploadProgress(100)
      setStatusMessage("Transcription complete")
      setSuccessMessage("Upload successful! Redirecting to editor...")
      // keep description for session; user-provided description is saved as upload.metadata on the server

      setTimeout(() => {
        if (onComplete) {
          onComplete({ uploadId: prepared.uploadId, transcriptId: transcription.transcriptId })
        } else {
          router.push(`/dashboard/editor/${prepared.uploadId}`)
        }
      }, 800)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
      console.error(err)
    } finally {
      setIsLoading(false)
      setStatusMessage(null)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div
        className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        <input ref={fileInputRef} type="file" onChange={handleFileChange} accept="video/*" className="hidden" />
        <Upload className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
        <p className="font-semibold mb-2">{file ? file.name : "Click to upload or drag and drop"}</p>
        <p className="text-sm text-muted-foreground">MP4, WebM, MOV • Max 2GB</p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Video Description</label>
        <textarea
          placeholder="Add a short description for the video (required)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          rows={4}
          required
        />
      </div>

      {error && (
        <div className="flex gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-md text-destructive">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {uploadProgress > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>{statusMessage ?? "Working..."}</span>
            <span>{uploadProgress}%</span>
          </div>
          <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
            <div className="bg-primary h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
          </div>
        </div>
      )}

      {successMessage && !error && (
        <div className="flex gap-2 p-3 bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-md">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">{successMessage}</p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isLoading || !file} size="lg">
        {isLoading ? (
          <>
            <Loader className="w-4 h-4 mr-2 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Upload className="w-4 h-4 mr-2" />
            Upload & Process
          </>
        )}
      </Button>
    </form>
  )
}

async function prepareSignedUpload(file: File, description: string) {
  const response = await fetch("/api/videos/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      metadata: {
        description,
      },
    }),
  })

  const data = (await response.json()) as UploadPreparation & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || "Failed to prepare upload")
  }
  return data
}

async function uploadFileWithProgress(payload: UploadPreparation, file: File, onProgress: (progress: number) => void) {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    // Oracle Object Storage uses PUT with raw file body
    xhr.open("PUT", payload.uploadUrl)
    xhr.setRequestHeader("Content-Type", file.type)

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      const percent = Math.round((event.loaded / event.total) * 100)
      onProgress(percent)
    }

    xhr.onerror = () => reject(new Error("Network error while uploading to Oracle storage"))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100)
        resolve()
      } else {
        reject(new Error(`Oracle storage upload failed (${xhr.status}) - ${xhr.responseText || "No response body"}`))
      }
    }

    // Send raw file (not FormData) for Oracle Object Storage
    xhr.send(file)
  })
}

type ManualOverridePayload = {
  text?: string
  language?: string
  model?: string
  segments?: Array<{ id?: string; start?: number; end?: number; text: string }>
  rawResponse?: unknown
}

const USE_MOCK_TRANSCRIPTION = process.env.NEXT_PUBLIC_ENABLE_TRANSCRIPTION_MOCKS === "true"

async function startTranscription(
  uploadId: string,
  override?: ManualOverridePayload,
  options?: { useMocks?: boolean },
): Promise<TranscriptionResult> {
  const response = await fetch("/api/videos/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, override, useMocks: options?.useMocks ?? false }),
  })

  const data = (await response.json()) as TranscriptionResult & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || "Failed to transcribe video")
  }
  return data
}

function buildManualOverridePayload({
  transcriptText,
  rawTranscriptJson,
  language,
}: {
  transcriptText: string
  rawTranscriptJson: string
  language: string
}): ManualOverridePayload {
  const cleanJson = rawTranscriptJson.trim()
  if (cleanJson) {
    try {
      const parsed = JSON.parse(cleanJson)
      return {
        rawResponse: parsed,
        language: language || undefined,
      }
    } catch (error) {
      throw new Error("Invalid transcription JSON. Please ensure it is valid JSON.")
    }
  }

  const text = transcriptText.trim()
  if (!text) {
    throw new Error("Provide either transcript text or transcript JSON")
  }

  return {
    text,
    language: language || undefined,
  }
}
