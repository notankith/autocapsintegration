import { NextResponse } from "next/server"

export async function POST() {
  try {
    // Build a redirect response and clear the auth cookie strictly
    const redirectUrl = "/auth/login"
    const res = NextResponse.redirect(redirectUrl, 303)

    // Clear cookie by setting an expired cookie on the response
    // This uses the NextResponse cookies API available on the response object
    try {
      res.cookies.set({ name: "auth_token", value: "", path: "/", expires: new Date(0) })
    } catch (err) {
      // Some Next.js runtimes may not expose response.cookies; fall back to returning JSON
      console.warn("Could not set cookie on response; logout will still attempt to clear client cookie", err)
      return NextResponse.json({ success: true })
    }

    return res
  } catch (error) {
    console.error("Logout error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
