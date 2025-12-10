"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Upload, AlertCircle, Loader, CheckCircle, FileText } from "lucide-react"
import { useRouter } from "next/navigation"

export default function DashboardPage() {
  const [file, setFile] = useState<File | null>(null)
  const [description, setDescription] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
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
      setSuccess(false)
      // leave description empty for user to fill
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const droppedFile = e.dataTransfer.files?.[0]
    if (droppedFile?.type.startsWith("video/")) {
      handleFileChange({ target: { files: e.dataTransfer.files } } as any)
    } else {
      setError("Please drop a video file")
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
    setSuccess(false)
    setUploadProgress(0)
    setStatusMessage("Preparing upload...")

    try {
      const prepared = await prepareSignedUpload(file, {
        description,
      })
      setStatusMessage("Uploading to Oracle Object Storage...")
      await uploadFileWithProgress(
        prepared,
        file,
        (progress) => setUploadProgress(Math.min(progress, 99)),
      )

      setStatusMessage("Transcribing with AssemblyAI...")
      await startTranscription(prepared.uploadId, undefined, { useMocks: USE_MOCK_TRANSCRIPTION })

      setSuccess(true)
      setUploadProgress(100)
      setFile(null)
      setDescription("")

      setTimeout(() => {
        router.push(`/dashboard/workspace/${prepared.uploadId}`)
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred")
    } finally {
      setIsLoading(false)
      setStatusMessage(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-card to-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-3 text-balance">
            Create Captions in <span className="text-primary">Seconds</span>
          </h1>
          <p className="text-lg text-muted-foreground text-balance">
            Upload your video and captions will be generated automatically using AI
          </p>
        </div>

        {/* Main Upload Form */}
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Video Upload Area */}
          <div
            className="border-2 border-dashed border-border rounded-2xl p-12 text-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-all duration-300 group"
            onClick={() => document.getElementById("video-input")?.click()}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <input id="video-input" type="file" onChange={handleFileChange} accept="video/*" className="hidden" />
            <div className="flex flex-col items-center gap-4">
              <div className="p-4 bg-primary/10 rounded-xl group-hover:bg-primary/15 transition-colors">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <div>
                {file ? (
                  <p className="font-semibold text-foreground">{file.name}</p>
                ) : (
                  <>
                    <p className="font-semibold text-foreground mb-1">Click to upload or drag and drop</p>
                    <p className="text-sm text-muted-foreground">MP4, WebM, MOV • Max 2GB</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Video Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-semibold mb-2">
              Video Description
            </label>
            <textarea
              id="description"
              placeholder="Add a short description for the video (required)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none text-base"
              rows={4}
              required
            />
          </div>

          {statusMessage && (
            <div className="bg-secondary/30 border border-secondary rounded-lg p-4 text-sm flex items-center justify-between">
              <span>{statusMessage}</span>
              {uploadProgress > 0 && <span>{uploadProgress}%</span>}
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex gap-3 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive animate-in fade-in slide-in-from-top-2 duration-300">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="flex gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-700 dark:text-green-400 animate-in fade-in slide-in-from-top-2 duration-300">
              <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p className="text-sm">Video uploaded successfully! Redirecting...</p>
            </div>
          )}

          {/* Submit Button */}
          <Button type="submit" className="w-full h-12 text-base font-semibold" disabled={isLoading || !file} size="lg">
            {isLoading ? (
              <>
                <Loader className="w-5 h-5 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5 mr-2" />
                Upload & Auto-Transcribe
              </>
            )}
          </Button>
        </form>

        {/* Footer Info */}
        <div className="mt-16 pt-8 border-t border-border text-center">
          <p className="text-sm text-muted-foreground">
            Your videos are securely stored and processed. No data is shared with third parties.
          </p>
        </div>
      </div>
    </div>
  )
}

type UploadPreparation = {
  uploadId: string
  uploadUrl: string
  token: string
}

async function prepareSignedUpload(file: File, metadata: Record<string, unknown>) {
  const response = await fetch("/api/videos/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      metadata,
    }),
  })

  const data = (await response.json()) as UploadPreparation & { error?: string }
  if (!response.ok) {
    throw new Error(data.error || "Upload failed")
  }
  return data
}

/**
 * Oracle Object Storage upload with progress tracking.
 * Uses PUT with raw file bytes (not FormData).
 */
async function uploadFileWithProgress(
  payload: UploadPreparation,
  file: File,
  onProgress: (progress: number) => void,
) {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open("PUT", payload.uploadUrl)
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream")

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return
      onProgress(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onerror = () => reject(new Error("Network error while uploading to Oracle storage"))
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(
          new Error(
            `Oracle storage upload failed (${xhr.status}) - ${xhr.responseText || "No response body"}`,
          ),
        )
      }
    }

    // Send raw file bytes directly
    xhr.send(file)
  })
}

type ManualOverridePayload = {
  text?: string
  language?: string
  segments?: Array<{ id?: string; start?: number; end?: number; text: string }>
  rawResponse?: unknown
}

const USE_MOCK_TRANSCRIPTION = process.env.NEXT_PUBLIC_ENABLE_TRANSCRIPTION_MOCKS === "true"

async function startTranscription(
  uploadId: string,
  override?: ManualOverridePayload,
  options?: { useMocks?: boolean },
) {
  const response = await fetch("/api/videos/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, override, useMocks: options?.useMocks ?? false }),
  })

  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error || "Failed to start transcription")
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
      return { rawResponse: parsed, language: language || undefined }
    } catch (error) {
      throw new Error("Invalid transcription JSON. Please double-check the payload.")
    }
  }

  const text = transcriptText.trim()
  if (!text) {
    throw new Error("Provide transcript text or raw JSON")
  }

  return {
    text,
    language: language || undefined,
  }
}
