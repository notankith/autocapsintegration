import { type NextRequest, NextResponse } from "next/server"
import { getDb } from "@/lib/mongodb"
import { getPublicUrl } from "@/lib/oracle-storage"
import { ObjectId } from "mongodb"
import { getCurrentUser } from "@/lib/auth"

// When a client requests a signed URL for an upload, perform a HEAD check against storage
// and update the DB record if the file is already present. This ensures shared links
// become resolvable even if the client who created the upload didn't call a finalize endpoint.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await getDb()
  
  const user = await getCurrentUser()
  const userId = user?.userId || "default-user"

  let upload
  try {
    // Allow looking up by ID only so shared links can be resolved by recipients
    upload = await db.collection("uploads").findOne({ _id: new ObjectId(id) })
  } catch (error) {
    return NextResponse.json({ error: "Invalid upload ID format" }, { status: 400 })
  }

  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 })
  }

  const signedUrl = getPublicUrl(upload.storage_path)

  // If upload is still marked pending on the server, try to confirm the file exists in storage.
  // If it does, update the DB record so shared recipients can access it immediately.
  if (upload.status === "pending_upload") {
    try {
      const headResp = await fetch(signedUrl, { method: "HEAD" })
      if (headResp.ok) {
        const sizeHeader = headResp.headers.get("content-length")
        const typeHeader = headResp.headers.get("content-type")
        const size = sizeHeader ? Number(sizeHeader) : null

        await db.collection("uploads").updateOne(
          { _id: upload._id },
          { $set: { status: "uploaded", file_size: size, mime_type: typeHeader ?? upload.mime_type, updated_at: new Date() } }
        )
      }
    } catch (err) {
      // ignore network issues; just return the signedUrl (it may still work client-side)
      console.warn("Signed-url HEAD check failed", err)
    }
  }

  return NextResponse.json({ signedUrl })
}