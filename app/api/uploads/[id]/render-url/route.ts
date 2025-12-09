import { getDb } from "@/lib/mongodb"
import { getPublicUrl } from "@/lib/oracle-storage"
import { NextResponse, type NextRequest } from "next/server"
import { ObjectId } from "mongodb"
import { getCurrentUser } from "@/lib/auth"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await getDb()
  
  const user = await getCurrentUser()
  const userId = user?.userId || "default-user"

  let upload
  try {
    // Lookup by id only so recipients can request render URL
    upload = await db.collection("uploads").findOne({ _id: new ObjectId(id) })
  } catch (error) {
    return NextResponse.json({ error: "Invalid upload ID format" }, { status: 400 })
  }

  if (!upload) {
    return NextResponse.json({ error: "Upload not found" }, { status: 404 })
  }

  if (!upload.render_asset_path) {
    return NextResponse.json({ error: "Rendered file not ready" }, { status: 404 })
  }

  const signedUrl = getPublicUrl(upload.render_asset_path)

  // Optionally confirm the rendered asset is present and update DB if needed
  try {
    const headResp = await fetch(signedUrl, { method: "HEAD" })
    if (!headResp.ok) {
      return NextResponse.json({ error: "Rendered asset not available" }, { status: 404 })
    }
  } catch (err) {
    console.warn("Render-url HEAD check failed", err)
  }

  return NextResponse.json({ signedUrl })
}
