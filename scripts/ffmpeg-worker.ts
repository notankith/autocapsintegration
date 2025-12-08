import { createServer } from "node:http"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process"
import jwt from "jsonwebtoken"
import { MongoClient, ObjectId, type Db } from "mongodb"
import { STORAGE_PREFIX, RENDER_RESOLUTIONS, type CaptionTemplate, type RenderOverlay } from "@/lib/pipeline"
import "dotenv/config"

// FINAL AND ONLY FFmpeg BINARY
const ffmpegBinary = process.env.FFMPEG_PATH || "ffmpeg"
const CREATOR_KINETIC_FONT_PATH = join(process.cwd(), "public", "fonts", "THEBOLDFONT-FREEVERSION.ttf")
const CREATOR_KINETIC_FONT_DIR = join(process.cwd(), "public", "fonts")

type RenderJobPayload = {
  jobId: string
  uploadId: string
  videoPath: string
  captionPath: string
  captionFormat: "srt" | "ass"
  template: CaptionTemplate
  resolution: keyof typeof RENDER_RESOLUTIONS | string
  outputPath: string
  videoUrl?: string
  captionUrl?: string
  overlays?: Array<{ url: string; start: number; end: number; x?: number; y?: number; width?: number; height?: number }>
}

const WORKER_SECRET = process.env.WORKER_JWT_SECRET
const MONGODB_URI = process.env.MONGODB_URI
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "autocaps"
const ORACLE_PAR_URL = process.env.ORACLE_PAR_URL
const PORT = Number(process.env.FFMPEG_WORKER_PORT ?? 8787)

if (!WORKER_SECRET || !MONGODB_URI || !ORACLE_PAR_URL) {
  throw new Error("Missing WORKER_JWT_SECRET, MONGODB_URI, or ORACLE_PAR_URL")
}

// MongoDB connection
let mongoClient: MongoClient
let db: Db
let isConnecting = false

async function connectMongo() {
  if (db) {
    console.log("[worker] MongoDB already connected")
    return db
  }

  if (isConnecting) {
    console.log("[worker] MongoDB connection in progress, waiting...")
    while (isConnecting && !db) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    if (db) return db
  }

  isConnecting = true
  try {
    console.log("[worker] Connecting to MongoDB...")
    mongoClient = new MongoClient(MONGODB_URI!)
    await mongoClient.connect()
    db = mongoClient.db(MONGODB_DB_NAME)
    
    // Test connection
    await db.admin().ping()
    console.log("[worker] Connected to MongoDB database:", MONGODB_DB_NAME)
    
    return db
  } catch (err) {
    console.error("[worker] MongoDB connection failed:", err)
    throw err
  } finally {
    isConnecting = false
  }
}

// Initialize MongoDB connection on startup
connectMongo()
  .then(() => console.log("[worker] MongoDB initialized successfully"))
  .catch(err => {
    console.error("[worker] Failed to initialize MongoDB:", err)
    process.exit(1)
  })

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  const pathname = url.pathname.replace(/\/+$/, "") || "/"

  if (["/", "/health"].includes(pathname) && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ status: "ok", route: pathname, timestamp: new Date().toISOString() }))
    return
  }

  if (req.method !== "POST" || pathname !== "/render") {
    res.writeHead(404).end("Not found")
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    res.writeHead(401).end("Missing token")
    return
  }

  try {
    jwt.verify(authHeader.replace("Bearer ", ""), WORKER_SECRET)
  } catch {
    res.writeHead(401).end("Invalid token")
    return
  }

  const body = await readBody(req)
  try {
    const payload = JSON.parse(body) as RenderJobPayload
    
    // Ensure MongoDB is connected before processing
    await connectMongo()
    
    await processJob(payload)
    res.writeHead(202).end(JSON.stringify({ accepted: true, jobId: payload.jobId }))
  } catch (error) {
    console.error("Worker failed:", error)
    res.writeHead(500).end("Worker error")
  }
}).listen(PORT, "0.0.0.0", () => {
 console.log(`FFmpeg worker listening on :${PORT} (public)`)
})

async function processJob(payload: RenderJobPayload) {
  console.log("[worker] Received job", payload.jobId, {
    uploadId: payload.uploadId,
    videoPath: payload.videoPath,
    captionPath: payload.captionPath,
    resolution: payload.resolution,
    template: payload.template,
  })

  const jobId = payload.jobId
  const resolutionKey = resolveResolutionKey(payload.resolution)
  let jobResultState: Record<string, any> = {}

  const commitJobResultState = (patch: Record<string, any>) => {
    jobResultState = { ...jobResultState, ...patch }
    return jobResultState
  }

  const updateJobResult = async (patch: Record<string, any>) => {
    commitJobResultState(patch)
    await updateJob(jobId, { result: { ...jobResultState } })
  }

  if (!resolutionKey) throw new Error(`Unsupported resolution: ${payload.resolution}`)
  const resolution = RENDER_RESOLUTIONS[resolutionKey]

  await updateJob(jobId, {
    status: "processing",
    started_at: new Date(),
  })

  const videoTmp = join(tmpdir(), `${jobId}-video`)
  const captionTmp = join(tmpdir(), `${jobId}-caption`)
  const outputTmp = join(tmpdir(), `${jobId}-render.mp4`)
  // Overlay files will be downloaded into temp paths and cleaned up in finally
  let overlayFiles: Array<RenderOverlay & { path?: string }> = []
  let fontsDir: string | undefined;

  try {
    console.log("=== Getting Oracle Storage URLs ===")

    const [videoUrl, captionUrl] = await Promise.all([
      ensureSignedUrl(payload.videoUrl, "uploads", payload.videoPath),
      ensureSignedUrl(payload.captionUrl, "captions", payload.captionPath),
    ])

    console.log("Signed video URL:", videoUrl)
    console.log("Signed caption URL:", captionUrl)

    await downloadToFile(videoUrl, videoTmp)
    await downloadToFile(captionUrl, captionTmp)

    // Get video duration using ffprobe after video is downloaded
    const videoDuration = getVideoDuration(videoTmp)
    console.log("[worker] Video duration:", videoDuration)

    if (typeof videoDuration === "number" && Number.isFinite(videoDuration) && videoDuration > 0) {
      await updateJobResult({ progress: 0 })
    }

    // Clamp overlays to video duration
    if (Array.isArray(payload.overlays) && typeof videoDuration === "number") {
      payload.overlays = payload.overlays.map((ov: any) => ({
        ...ov,
        end: Math.min(ov.end, videoDuration)
      }))
    }

    // Download overlays (if any) to local temp files for ffmpeg input
    overlayFiles = []
    if (payload.overlays && payload.overlays.length) {
      for (let i = 0; i < payload.overlays.length; i++) {
        const ov = payload.overlays[i]
        try {
          // Try to derive extension from URL (default to .gif)
          const extMatch = (ov.url || "").match(/\.(gif|webp|png|mp4)(?:$|[?#])/i)
          const ext = extMatch ? extMatch[1] : "gif"
          const overlayTmp = join(tmpdir(), `${jobId}-overlay-${i}.${ext}`)
          await downloadToFile(ov.url, overlayTmp)
          overlayFiles.push({ url: ov.url, path: overlayTmp, start: ov.start, end: ov.end, x: ov.x, y: ov.y, width: ov.width, height: ov.height })
        } catch (err) {
          console.warn(`[worker] Failed to download overlay ${ov.url} — skipping`, err)
        }
      }
    }

    console.log("[worker] Downloaded inputs, launching FFmpeg", { jobId })

    // Copy font to temp directory to avoid path issues
    fontsDir = CREATOR_KINETIC_FONT_DIR
    // Check if template is karaoke (CreatorKinetic)
    if (payload.template === "karaoke") {
      try {
        // Create a unique directory for this job to avoid scanning garbage
        const uniqueFontDir = join(tmpdir(), `fonts_${jobId}`)
        await fs.mkdir(uniqueFontDir, { recursive: true })
        
        const fontName = "CustomFont.ttf" // Simple name to avoid issues
        const fontDest = join(uniqueFontDir, fontName)
        
        // Ensure we are copying from the correct source path
        const sourceFontPath = CREATOR_KINETIC_FONT_PATH
        console.log(`[worker] Copying font from ${sourceFontPath} to ${fontDest}`)
        await fs.copyFile(sourceFontPath, fontDest)
        
        fontsDir = uniqueFontDir
        console.log("[worker] Copied font to unique temp dir:", fontsDir)
      } catch (e) {
        console.warn("[worker] Failed to copy font to temp, using original path:", e)
      }
    }

    let lastProgressRatio = 0
    let lastProgressPersist = 0

    const handleProgressTimestamp = (timestampSeconds: number) => {
      if (typeof videoDuration !== "number" || !Number.isFinite(videoDuration) || videoDuration <= 0) {
        return
      }

      const ratio = Math.max(0, Math.min(1, timestampSeconds / videoDuration))
      const now = Date.now()
      // Update more frequently: 0.5% change or 300ms elapsed
      if (ratio - lastProgressRatio < 0.005 && now - lastProgressPersist < 300) {
        return
      }
      lastProgressRatio = ratio
      lastProgressPersist = now

      updateJobResult({ progress: Number(ratio.toFixed(4)) }).catch((error) => {
        console.warn("[worker] Failed to persist progress", { jobId, error })
      })
    }

    await runFfmpeg(
      videoTmp,
      captionTmp,
      outputTmp,
      payload.captionFormat,
      payload.template,
      `${resolution.width}x${resolution.height}`,
      overlayFiles,
      fontsDir,
      { onProgressTimestamp: handleProgressTimestamp }
    )

    const file = await fs.readFile(outputTmp)
    console.log("[worker] Uploading render to Oracle Storage", {
      jobId,
      path: payload.outputPath,
      bytes: file.length,
    })
    
    // Upload to Oracle Object Storage
    const uploadUrl = getOracleStorageUrl(payload.outputPath)
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: new Uint8Array(file),
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(file.length),
      },
    })

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text()
      console.error("[worker] Render upload failed", errorText)
      throw new Error(`Render upload failed: ${uploadResponse.status} - ${errorText}`)
    }

    const downloadUrl = getOracleStorageUrl(payload.outputPath)

    console.log("[worker] Upload complete, updating job", { jobId })
    commitJobResultState({
      progress: 1,
      downloadUrl,
      storagePath: payload.outputPath,
    })

    await updateJob(jobId, {
      status: "done",
      completed_at: new Date(),
      result: { ...jobResultState },
    })

    await updateUploadRenderState(payload.uploadId, {
      status: "rendered",
      render_asset_path: payload.outputPath,
      updated_at: new Date(),
    })

    console.log("[worker] Job completed", { jobId })

  } catch (err) {
    console.error("[worker] Job failed", { jobId, error: err })
    await updateJob(jobId, {
      status: "failed",
      error: (err as Error).message,
      completed_at: new Date(),
      result: { ...jobResultState },
    })

    await db.collection("uploads").updateOne(
      { _id: new ObjectId(payload.uploadId) },
      { $set: { status: "render_failed", updated_at: new Date() } }
    )

    throw err
  } finally {
    await safeUnlink(videoTmp)
    await safeUnlink(captionTmp)
    await safeUnlink(outputTmp)
    // cleanup overlays
    if (Array.isArray(overlayFiles) && overlayFiles.length) {
      for (const f of overlayFiles) {
        if (f.path) await safeUnlink(f.path as string)
      }
    }
    // cleanup fonts dir if it was created in temp
    if (fontsDir && fontsDir.startsWith(tmpdir()) && fontsDir !== tmpdir()) {
      try {
        await fs.rm(fontsDir, { recursive: true, force: true })
      } catch (e) {
        console.warn("[worker] Failed to cleanup fonts dir:", e)
      }
    }
  }
}

async function updateJob(jobId: string, patch: Record<string, any>) {
  try {
    const result = await db.collection("jobs").updateOne(
      { _id: new ObjectId(jobId) },
      { $set: patch }
    )
    console.log("[worker] Job updated", { jobId, patch, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount })
    if (result.matchedCount === 0) {
      console.warn("[worker] Job not found in database", { jobId })
    }
  } catch (error) {
    console.error("[worker] Job update failed", { jobId, patch, error })
    throw new Error(`Job update failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function updateUploadRenderState(
  uploadId: string,
  patch: Record<string, any>,
): Promise<{ missingRenderColumn: boolean }> {
  try {
    const result = await db.collection("uploads").updateOne(
      { _id: new ObjectId(uploadId) },
      { $set: patch }
    )
    console.log("[worker] Upload updated", { uploadId, patch, matchedCount: result.matchedCount, modifiedCount: result.modifiedCount })
    if (result.matchedCount === 0) {
      console.warn("[worker] Upload not found in database", { uploadId })
    }
    return { missingRenderColumn: false }
  } catch (error) {
    console.error("[worker] Failed to update upload row", error)
    throw new Error(`Failed to update upload row: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Removed isMissingRenderColumnError - no longer needed with MongoDB

function resolveResolutionKey(res: string | undefined): keyof typeof RENDER_RESOLUTIONS | null {
  if (!res) return null
  const n = String(res).toLowerCase().replace(/\s+/g, "")
  if (n in RENDER_RESOLUTIONS) return n as keyof typeof RENDER_RESOLUTIONS
  if (n === "1080") return "1080p"
  if (n === "720") return "720p"
  return null
}

async function downloadToFile(url: string, target: string) {
  const res = await fetch(url)
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Download failed: ${res.status} - ${txt}`)
  }
  const payload = new Uint8Array(await res.arrayBuffer())
  await fs.writeFile(target, payload)
}

function runFfmpeg(
  video: string,
  captions: string,
  out: string,
  fmt: "srt" | "ass",
  template: CaptionTemplate,
  _res: string,
  overlays: RenderOverlay[] = [],
  customFontsDir?: string,
  options?: { onProgressTimestamp?: (seconds: number) => void }
) {
  // Center captions in the middle of the video using ASS alignment override (align=2)
  let forceStyle =
    template === "minimal"
      ? "Fontname=Inter,Fontsize=40,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,BackColour=&H64000000&,BorderStyle=4,Alignment=2"
      : "Alignment=2";

  // Force the font for Creator Kinetic (karaoke) to ensure it picks up the custom font
  if (template === "karaoke") {
    forceStyle += ",Fontname=THE BOLD FONT (FREE VERSION)";
  }

  const escapedCaptions = escapeFilterPath(captions);
  const escapedFontsDir = escapeFilterPath(customFontsDir || CREATOR_KINETIC_FONT_DIR);

  // Build subtitles filter string
  const subtitlesFilter = (() => {
    if (fmt === "ass") {
      const fontsDirParam = template === "karaoke" ? `:fontsdir=${escapedFontsDir}` : "";
      return `subtitles='${escapedCaptions}${fontsDirParam}'`;
    } else if (forceStyle) {
      return `subtitles='${escapedCaptions}:force_style=${forceStyle}'`;
    } else {
      return `subtitles='${escapedCaptions}'`;
    }
  })();
  // Always apply overlays first, then subtitles, then fps/format
  const args: string[] = [];
  if (!overlays || overlays.length === 0) {
    const filterComplex = `[0:v]fps=30,format=yuv420p[base];[base]${subtitlesFilter}[final]`;
    console.log("[worker] FFmpeg filter_complex:", filterComplex);
    try {
      const assPreview = require('fs').readFileSync(captions, 'utf-8').split('\n').slice(0, 20).join('\n');
      console.log("[worker] ASS file preview:\n", assPreview);
    } catch (e) {
      console.warn("[worker] Could not read ASS file for preview", e);
    }
    args.push(
      "-y",
      "-i", video,
      "-filter_complex", filterComplex,
      "-map", "[final]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-profile:v", "high",
      "-level", "4.1",
      "-pix_fmt", "yuv420p",
      "-preset", "medium",
      "-crf", "18",
      "-r", "30",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",
      "-shortest",
      out
    );
  } else {
    args.push("-y", "-i", video);
    overlays.forEach((ov) => {
      const input = (ov as any).path ?? ov.url;
      args.push("-stream_loop", "-1", "-i", String(input));
    });
    // Build filter_complex string
    const filterParts: string[] = [];
    filterParts.push(`[0:v]fps=30,format=yuv420p[base]`);
    overlays.forEach((ov, i) => {
      const inputIndex = i + 1;
      const scaledLabel = `ovsc${i}`;
      const start = Math.max(0, ov.start);
      const end = Math.max(start, ov.end);
      // Scale GIF to 50px width (smaller) and add subtle wiggle
      const width = 75;
      // Wiggle: +/- 3deg (0.05rad), speed 5. c=none preserves transparency.
      // ow/oh increased to prevent clipping during rotation.
      filterParts.push(`[${inputIndex}:v] scale=${width}:-1,rotate=a='0.05*sin(5*t)':ow='iw*1.2':oh='ih*1.2':c=none [${scaledLabel}]`);
      
      // Center horizontally
      const x = `(main_w-overlay_w)/2`;
      
      // Dynamic Y position with rise-up animation
      // We assume text is roughly 60px tall.
      let targetYExpr = "";
      let startYExpr = "";

      if (template === "karaoke") {
         // Text center is main_h/2. Text top ~ main_h/2 - 40.
         // Target: Above text (closer).
         targetYExpr = `(main_h/2)-25-overlay_h`;
         // Start: Center of text.
         startYExpr = `(main_h/2)-(overlay_h/2)`;
      } else {
         // Text bottom is approx main_h - 50. Text top ~ main_h - 110.
         // Target: Above text (closer).
         targetYExpr = `main_h-105-overlay_h`;
         // Start: Center of text (approx main_h - 80).
         startYExpr = `main_h-80-(overlay_h/2)`;
      }
      
      // Animation: Rise up from startY to targetY over 0.4s
      // y = startY + (targetY - startY) * progress
      // IMPORTANT: Wrap the expression in single quotes to prevent argument parsing issues
      let y = `'${startYExpr}+(${targetYExpr}-(${startYExpr}))*min(1,(t-${start})/0.4)'`;

      const prevLabel = i === 0 ? "base" : `v${i}`;
      const outLabel = `v${i + 1}`;
      const enable = `between(t,${start},${end})`;
      filterParts.push(`[${prevLabel}][${scaledLabel}] overlay=x=${x}:y=${y}:enable='${enable}' [${outLabel}]`);
    });
    // After all overlays, apply subtitles strictly last
    const overlayFinalLabel = overlays.length ? `v${overlays.length}` : "base";
    filterParts.push(`[${overlayFinalLabel}]${subtitlesFilter}[final]`);
    const filterComplex = filterParts.join(";");

    console.log("[worker] FFmpeg filter_complex:", filterComplex);
    try {
      const assPreview = require('fs').readFileSync(captions, 'utf-8').split('\n').slice(0, 20).join('\n');
      console.log("[worker] ASS file preview:\n", assPreview);
    } catch (e) {
      console.warn("[worker] Could not read ASS file for preview", e);
    }
    args.push(
      "-filter_complex", filterComplex,
      "-map", "[final]",
      "-map", "0:a?",
      "-c:v", "libx264",
      "-profile:v", "high",
      "-level", "4.1",
      "-pix_fmt", "yuv420p",
      "-preset", "medium",
      "-crf", "18",
      "-r", "30",
      "-movflags", "+faststart",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",
      "-shortest",
      out
    );
  }

  return new Promise<void>((resolve, reject) => {
    const ff = spawn(ffmpegBinary, args) as ChildProcessWithoutNullStreams
    ff.stderr.on("data", (chunk: Buffer) => {
      const payload = chunk.toString()
      console.log(payload)

      if (options?.onProgressTimestamp) {
        const timestamps = extractTimestampSeconds(payload)
        timestamps.forEach((seconds) => options.onProgressTimestamp?.(seconds))
      }
    })
    ff.on("close", (code: number | null) => (code === 0 ? resolve() : reject(new Error(`FFmpeg exited: ${code}`))))
  })
}

function extractTimestampSeconds(payload: string): number[] {
  const matches = payload.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/g)
  if (!matches) return []

  return matches
    .map((entry) => {
      const match = entry.match(/time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/)
      if (!match) return null
      const [, hh, mm, ss] = match
      const seconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss)
      return Number.isFinite(seconds) ? seconds : null
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
}

async function safeUnlink(path: string) {
  try { await fs.unlink(path) } catch {}
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = ""
    req.on("data", (c: Buffer) => (d += c))
    req.on("end", () => resolve(d))
    req.on("error", reject)
  })
}

// Helper to escape paths used inside FFmpeg filter expressions
function escapeFilterPath(path: string) {
  return path.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/ /g, "\\ ")
}

// Retrieve Oracle storage URL
function getOracleStorageUrl(path: string): string {
  if (!ORACLE_PAR_URL) throw new Error("ORACLE_PAR_URL not configured")
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path
  return `${ORACLE_PAR_URL}${cleanPath}`
}

async function ensureSignedUrl(url: string | undefined, _bucket: string, path: string) {
  if (url) return url
  if (!path) throw new Error("Missing storage path")
  return getOracleStorageUrl(path)
}

function getVideoDuration(filePath: string): number {
  try {
    // Try using ffprobe first (if available in PATH)
    const result = spawnSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ])
    
    if (result.status === 0) {
      const duration = parseFloat(result.stdout.toString().trim())
      if (!isNaN(duration)) return duration
    }
    
    // Fallback to ffmpeg if ffprobe fails
    // ffmpeg output goes to stderr
    const ffmpegResult = spawnSync(ffmpegBinary, ["-i", filePath])
    const output = ffmpegResult.stderr.toString()
    const match = output.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/)
    if (match) {
      const hours = parseFloat(match[1])
      const minutes = parseFloat(match[2])
      const seconds = parseFloat(match[3])
      return hours * 3600 + minutes * 60 + seconds
    }
  } catch (e) {
    console.error("Failed to get video duration:", e)
  }
  return 0
}

