// AutoCaps - Integration Transcribe Endpoint
// Location: AutoCapsPersonal/app/api/integration/transcribe/route.ts

import { NextRequest, NextResponse } from "next/server"
import { verifyIntegrationToken } from "@/lib/integration-auth"
import { integrationService } from "@/lib/integration-service"
import { getDb } from "@/lib/mongodb"
import { uploadFile } from "@/lib/oracle-storage"
import { ObjectId } from "mongodb"
import type { TranscribeRequest } from "@/lib/types/integration"

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY

export async function POST(request: NextRequest) {
  // Verify authentication
  const token = verifyIntegrationToken(request)
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body: TranscribeRequest = await request.json()
    const { videoId, videoUrl, callbackUrl, metadata } = body

    if (!videoId || !videoUrl || !callbackUrl) {
      return NextResponse.json(
        { error: "Missing required fields: videoId, videoUrl, callbackUrl" },
        { status: 400 }
      )
    }

    console.log("[Integration/Transcribe] Request:", {
      videoId,
      videoUrl: videoUrl.substring(0, 50) + "...",
      callbackUrl
    })

    const db = await getDb()
    const userId = "integration_user"

    // Register integration video
    await integrationService.registerVideo(videoId, videoUrl, callbackUrl, metadata)

    // Create upload record
    const uploadResult = await db.collection("uploads").insertOne({
      user_id: userId,
      filename: metadata?.filename || `video_${videoId}.mp4`,
      storage_path: videoUrl,
      file_size: 0,
      duration: metadata?.duration || 0,
      status: "transcribing",
      language: "en",
      created_at: new Date(),
      updated_at: new Date()
    })

    const uploadId = uploadResult.insertedId.toString()

    // Create transcript placeholder
    const transcriptResult = await db.collection("transcripts").insertOne({
      upload_id: uploadId,
      user_id: userId,
      status: "processing",
      language: "en",
      segments: [],
      created_at: new Date(),
      updated_at: new Date()
    })

    const transcriptId = transcriptResult.insertedId.toString()

    // Link to integration video
    await integrationService.linkTranscription(videoId, uploadId, transcriptId)

    // Start transcription with AssemblyAI
    if (ASSEMBLYAI_API_KEY) {
      startTranscription(videoId, uploadId, transcriptId, videoUrl).catch(error => {
        console.error("[Integration/Transcribe] Background transcription failed:", error)
        integrationService.sendErrorCallback(videoId, "transcription", error)
      })
    } else {
      // Mock transcription for testing
      mockTranscription(videoId, uploadId, transcriptId).catch(console.error)
    }

    return NextResponse.json({
      success: true,
      transcriptionId: transcriptId,
      videoId,
      status: "queued",
      estimatedCompletionTime: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    })
  } catch (error) {
    console.error("[Integration/Transcribe] Error:", error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}

async function startTranscription(
  videoId: string,
  uploadId: string,
  transcriptId: string,
  videoUrl: string
): Promise<void> {
  const db = await getDb()

  try {
    // Call AssemblyAI
    const response = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: {
        "Authorization": ASSEMBLYAI_API_KEY!,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        audio_url: videoUrl,
        language_code: "en",
        word_boost: ["captions", "video"],
        format_text: true
      })
    })

    if (!response.ok) {
      throw new Error(`AssemblyAI API error: ${response.status}`)
    }

    const data = await response.json()
    const assemblyId = data.id

    // Poll for completion
    await pollAssemblyAI(videoId, uploadId, transcriptId, assemblyId)
  } catch (error) {
    console.error("[Integration/Transcribe] AssemblyAI error:", error)
    
    // Update status
    await db.collection("transcripts").updateOne(
      { _id: new ObjectId(transcriptId) },
      { $set: { status: "failed", error: (error as Error).message, updated_at: new Date() } }
    )

    // Send error callback
    await integrationService.sendErrorCallback(videoId, "transcription", error as Error)
  }
}

async function pollAssemblyAI(
  videoId: string,
  uploadId: string,
  transcriptId: string,
  assemblyId: string
): Promise<void> {
  const db = await getDb()
  const maxAttempts = 360 // 12 minutes at 2-second intervals
  let attempt = 0

  while (attempt < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 2000)) // Wait 2 seconds (was 5 seconds)

    try {
      const response = await fetch(`https://api.assemblyai.com/v2/transcript/${assemblyId}`, {
        headers: {
          "Authorization": ASSEMBLYAI_API_KEY!
        }
      })

      const data = await response.json()

      if (data.status === "completed") {
        // Convert AssemblyAI format to our format
        const segments = data.words?.map((word: any, idx: number) => ({
          id: `seg_${idx}`,
          start: word.start / 1000,
          end: word.end / 1000,
          text: word.text,
          words: [{
            text: word.text,
            start: word.start / 1000,
            end: word.end / 1000
          }]
        })) || []

        // Update transcript
        await db.collection("transcripts").updateOne(
          { _id: new ObjectId(transcriptId) },
          {
            $set: {
              status: "completed",
              segments,
              text: data.text,
              confidence: data.confidence || 0.95,
              updated_at: new Date()
            }
          }
        )

        // Update upload
        await db.collection("uploads").updateOne(
          { _id: new ObjectId(uploadId) },
          {
            $set: {
              status: "transcribed",
              updated_at: new Date()
            }
          }
        )

        // Send callback
        await integrationService.sendTranscriptionCallback(videoId)
        break
      } else if (data.status === "error") {
        throw new Error(data.error || "AssemblyAI transcription failed")
      }
    } catch (error) {
      console.error("[Integration/Transcribe] Polling error:", error)
      await integrationService.sendErrorCallback(videoId, "transcription", error as Error)
      break
    }

    attempt++
  }
}

async function mockTranscription(
  videoId: string,
  uploadId: string,
  transcriptId: string
): Promise<void> {
  // Wait 1 second to simulate processing (was 3 seconds)
  await new Promise(resolve => setTimeout(resolve, 1000))

  const db = await getDb()

  const mockSegments = [
    {
      id: "seg_1",
      start: 0.0,
      end: 2.5,
      text: "Hello world",
      words: [
        { text: "Hello", start: 0.0, end: 0.8 },
        { text: "world", start: 1.0, end: 2.5 }
      ]
    },
    {
      id: "seg_2",
      start: 2.5,
      end: 5.0,
      text: "This is a test video",
      words: [
        { text: "This", start: 2.5, end: 2.8 },
        { text: "is", start: 2.8, end: 3.0 },
        { text: "a", start: 3.0, end: 3.2 },
        { text: "test", start: 3.2, end: 3.6 },
        { text: "video", start: 3.8, end: 5.0 }
      ]
    }
  ]

  // Update transcript
  await db.collection("transcripts").updateOne(
    { _id: new ObjectId(transcriptId) },
    {
      $set: {
        status: "completed",
        segments: mockSegments,
        text: "Hello world. This is a test video.",
        confidence: 0.95,
        updated_at: new Date()
      }
    }
  )

  // Update upload
  await db.collection("uploads").updateOne(
    { _id: new ObjectId(uploadId) },
    { $set: { status: "transcribed", updated_at: new Date() } }
  )

  // Send callback
  await integrationService.sendTranscriptionCallback(videoId)
}
