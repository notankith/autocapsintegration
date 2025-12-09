import { redirect } from "next/navigation"
import { getDb } from "@/lib/mongodb"
import { ObjectId } from "mongodb"
import { PostUploadWorkspace } from "@/components/editor/post-upload-workspace"
import { getCurrentUser } from "@/lib/auth"

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params
  
  const user = await getCurrentUser()
  const userId = user?.userId || "default-user"

  const db = await getDb()
  
  // Look up upload by ID only so workspace links are resolvable by others
  // Security: allow public access only if upload exists and is not in pending state
  let upload
  try {
    upload = await db.collection("uploads").findOne({ _id: new ObjectId(resolvedParams.id) })
  } catch (err) {
    console.log(`[Workspace] Invalid upload id: ${resolvedParams.id}`)
    redirect("/dashboard")
  }

  if (!upload) {
    console.log(`[Workspace] Upload not found. ID: ${resolvedParams.id}`)
    redirect("/dashboard")
  }

  // If the upload is still pending (client didn't finish upload), we don't expose the workspace
  if (upload.status === "pending_upload") {
    console.log(`[Workspace] Upload pending and not ready. ID: ${resolvedParams.id}`)
    redirect("/dashboard")
  }

  // Respect expiration if set
  if (upload.expires_at && new Date() > new Date(upload.expires_at)) {
    console.log(`[Workspace] Upload expired. ID: ${resolvedParams.id}`)
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-card to-background px-4 py-10 md:px-10">
      <PostUploadWorkspace uploadId={upload._id.toString()} />
    </div>
  )
}
