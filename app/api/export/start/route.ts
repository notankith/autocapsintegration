import { NextResponse } from "next/server"
import { getDb } from "../../../../lib/mongodb"
import { getPublicUrl } from "../../../../lib/oracle-storage"

import type { NextRequest } from "next/server"

import { createAndTriggerJob } from "../../../../scripts/trigger-render"

export async function POST(req: NextRequest) {
  const enabled = process.env.ENABLE_PORTAL_EXPORT === "true"
  if (!enabled) {
    return NextResponse.json({ success: false, message: "Portal export disabled" }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ success: false, message: "Invalid JSON" }, { status: 400 })

  const { uploadId, fileName, description, portalId } = body
  if (!uploadId || !fileName) {
    return NextResponse.json({ success: false, message: "Missing uploadId or fileName" }, { status: 400 })
  }

  const db = await getDb()

  // Resolve the portal URL early so we can attach it to the render_jobs row
  const resolvedPortalUrl = (() => {
    try {
      if (portalId) {
        if (portalId === "default") return process.env.PORTAL_EXPORT_URL || null
        const key = `PORTAL_EXPORT_URL_${String(portalId)}`
        return process.env[key] || null
      }
      return process.env.PORTAL_EXPORT_URL || null
    } catch (e) {
      return process.env.PORTAL_EXPORT_URL || null
    }
  })()

  // Insert a render_jobs row immediately to avoid race with worker
  const jobDoc: any = {
    uploadId: String(uploadId),
    fileName: String(fileName),
    description: description ? String(description) : "",
    targetPortal: resolvedPortalUrl,
    status: "pending_render",
    attempts: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  const insert = await db.collection("render_jobs").insertOne(jobDoc as any)
  const renderJobId = insert.insertedId

  // Now trigger the render. We still allow client-provided segments/customStyles.
  let triggerResult: any
  try {
    const opts: any = {}
    if (body.segments) opts.segments = body.segments
    if (body.customStyles) opts.customStyles = body.customStyles
    triggerResult = await createAndTriggerJob(String(uploadId), Object.keys(opts).length ? opts : undefined)
  } catch (err) {
    console.error("Failed to trigger render for export job (create step)", err)
    // Mark the render job as trigger_failed so we don't lose visibility
    try {
      await db.collection("render_jobs").updateOne({ _id: renderJobId }, { $set: { status: "trigger_failed", error: String(err), updatedAt: new Date() } })
    } catch (e) {
      console.error("Failed to update render_jobs after trigger failure", e)
    }
    return NextResponse.json({ success: false, message: "Failed to create render job" }, { status: 500 })
  }

  // If the render trigger says there's an existing rendered asset we can reuse,
  // update the previously-created render_jobs row and attempt portal export now.
  if (triggerResult && triggerResult.skipped) {
    const renderedUrl = getPublicUrl(triggerResult.renderedPath)
    const captionHash = triggerResult.captionHash
    try {
      await db.collection("render_jobs").updateOne({ _id: renderJobId }, { $set: { status: "rendered", renderedVideoUrl: renderedUrl, captionHash, updatedAt: new Date() } })
    } catch (e) {
      console.error("Failed to mark render_jobs as rendered", e)
    }

    // Attempt portal export immediately (mirrors worker behavior)
    const portalUrl = process.env.PORTAL_EXPORT_URL || resolvedPortalUrl
    if (portalUrl) {
      const exportPayload = {
        fileName: jobDoc.fileName,
        description: jobDoc.description || "",
        renderedVideoUrl: renderedUrl,
        source: "AutoCaptions",
        jobId: renderJobId.toString(),
      }

      const maxAttempts = 3
      const workerAuth = process.env.WORKER_JWT_SECRET

      for (let attempts = 0; attempts < maxAttempts; attempts++) {
        try {
          const headers: Record<string, string> = { "Content-Type": "application/json" }
          if (workerAuth) headers["Authorization"] = `Bearer ${workerAuth}`
          if (process.env.PORTAL_SECRET) headers["x-portal-secret"] = process.env.PORTAL_SECRET

          const resp = await fetch(portalUrl, { method: "POST", headers, body: JSON.stringify(exportPayload) })
          if (resp.ok) {
            await db.collection("render_jobs").updateOne({ _id: renderJobId }, { $set: { status: "exported", attempts: attempts + 1, lastAttemptAt: new Date(), updatedAt: new Date() } })
            break
          } else {
            const text = await resp.text().catch(() => "")
            const retryDelayMs = Math.pow(2, attempts) * 60 * 1000
            await db.collection("render_jobs").updateOne({ _id: renderJobId }, { $set: { status: "export_failed", attempts: attempts + 1, lastAttemptAt: new Date(), nextAttemptAt: new Date(Date.now() + retryDelayMs), lastError: text, updatedAt: new Date() } })
          }
        } catch (err) {
          const retryDelayMs = Math.pow(2, attempts) * 60 * 1000
          await db.collection("render_jobs").updateOne({ _id: renderJobId }, { $set: { status: "export_failed", attempts: attempts + 1, lastAttemptAt: new Date(), nextAttemptAt: new Date(Date.now() + retryDelayMs), lastError: String(err), updatedAt: new Date() } })
        }
      }
    }

    return NextResponse.json({ success: true, jobId: renderJobId.toString(), skipped: true })
  }

  // Not skipped — update the render_jobs row to queued and attach worker job id if present
  try {
    if (triggerResult && triggerResult.jobId) {
      await db.collection("render_jobs").updateOne({ _id: renderJobId }, { $set: { workerJobId: triggerResult.jobId, status: "queued", updatedAt: new Date() } })
    } else {
      await db.collection("render_jobs").updateOne({ _id: renderJobId }, { $set: { status: "queued", updatedAt: new Date() } })
    }
  } catch (err) {
    console.error("Failed to update render_jobs after triggering render", renderJobId.toString(), err)
    try {
      await db.collection("render_jobs").updateOne({ _id: renderJobId }, { $set: { status: "trigger_failed", error: String(err), updatedAt: new Date() } })
    } catch (e) {
      console.error("Failed to mark render_jobs trigger_failed", e)
    }
  }

  return NextResponse.json({ success: true, jobId: renderJobId.toString() })
}
