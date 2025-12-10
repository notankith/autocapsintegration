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

  // First, ask the render trigger to either create a job or tell us that
  // an existing rendered asset can be reused (skip).
  let triggerResult: any
  try {
    // Allow client to provide current segments/customStyles so Send-to-Portal
    // uses the live editor state instead of a DB snapshot.
    const opts: any = {}
    if (body.segments) opts.segments = body.segments
    if (body.customStyles) opts.customStyles = body.customStyles
    triggerResult = await createAndTriggerJob(String(uploadId), Object.keys(opts).length ? opts : undefined)
  } catch (err) {
    console.error("Failed to trigger render for export job (create step)", err)
    return NextResponse.json({ success: false, message: "Failed to create render job" }, { status: 500 })
  }

  // Prepare the render_jobs document. If the trigger returned a skip result,
  // mark as rendered and attach the rendered URL. Otherwise insert as queued.
  const resolvedPortalUrl = (() => {
    try {
      if (portalId) {
        // If portalId is 'default' fall back to single env
        if (portalId === "default") return process.env.PORTAL_EXPORT_URL || null
        const key = `PORTAL_EXPORT_URL_${String(portalId)}`
        return process.env[key] || null
      }
      return process.env.PORTAL_EXPORT_URL || null
    } catch (e) {
      return process.env.PORTAL_EXPORT_URL || null
    }
  })()

  const jobDoc: any = {
    uploadId: String(uploadId),
    fileName: String(fileName),
    description: description ? String(description) : "",
    targetPortal: resolvedPortalUrl,
    attempts: 0,
    createdAt: new Date(),
  }

  if (triggerResult && triggerResult.skipped) {
    // Use the existing rendered asset
    jobDoc.status = "rendered"
    jobDoc.renderedVideoUrl = getPublicUrl(triggerResult.renderedPath)
    jobDoc.captionHash = triggerResult.captionHash
    const insert = await db.collection("render_jobs").insertOne(jobDoc)

    // If portal export configured, attempt to POST immediately (mirrors worker behavior)
    const portalUrl = process.env.PORTAL_EXPORT_URL || jobDoc.targetPortal
    if (portalUrl) {
      const exportPayload = {
        fileName: jobDoc.fileName,
        description: jobDoc.description || "",
        renderedVideoUrl: jobDoc.renderedVideoUrl,
        source: "AutoCaptions",
        jobId: insert.insertedId.toString(),
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
            await db.collection("render_jobs").updateOne({ _id: insert.insertedId }, { $set: { status: "exported", attempts: attempts + 1, lastAttemptAt: new Date() } })
            break
          } else {
            const text = await resp.text().catch(() => "")
            const retryDelayMs = Math.pow(2, attempts) * 60 * 1000
            await db.collection("render_jobs").updateOne({ _id: insert.insertedId }, { $set: { status: "export_failed", attempts: attempts + 1, lastAttemptAt: new Date(), nextAttemptAt: new Date(Date.now() + retryDelayMs), lastError: text } })
          }
        } catch (err) {
          const retryDelayMs = Math.pow(2, attempts) * 60 * 1000
          await db.collection("render_jobs").updateOne({ _id: insert.insertedId }, { $set: { status: "export_failed", attempts: attempts + 1, lastAttemptAt: new Date(), nextAttemptAt: new Date(Date.now() + retryDelayMs), lastError: String(err) } })
        }
      }
    }

    return NextResponse.json({ success: true, jobId: insert.insertedId.toString(), skipped: true })
  }

  // Not skipped — insert queued render job and attach workerJobId if available
  jobDoc.status = "queued"
  const insert = await db.collection("render_jobs").insertOne(jobDoc as any)
  const jobId = insert.insertedId.toString()

  try {
    if (triggerResult && triggerResult.jobId) {
      await db.collection("render_jobs").updateOne({ _id: insert.insertedId }, { $set: { workerJobId: triggerResult.jobId, status: "queued", updatedAt: new Date() } })
    } else {
      await db.collection("render_jobs").updateOne({ _id: insert.insertedId }, { $set: { status: "queued", updatedAt: new Date() } })
    }
  } catch (err) {
    console.error("Failed to update render_jobs after triggering render", jobId, err)
    try {
      await db.collection("render_jobs").updateOne({ _id: insert.insertedId }, { $set: { status: "trigger_failed", error: String(err), updatedAt: new Date() } })
    } catch (e) {
      console.error("Failed to mark render_jobs trigger_failed", e)
    }
  }

  return NextResponse.json({ success: true, jobId })
}
