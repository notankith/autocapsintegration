import { NextResponse } from "next/server"

export async function GET() {
  try {
    const portals: Array<{ id: string; name: string; url: string }> = []

    // Support up to three portals via env vars PORTAL_EXPORT_URL_1..3 and PORTAL_EXPORT_NAME_1..3
    for (let i = 1; i <= 3; i++) {
      const url = process.env[`PORTAL_EXPORT_URL_${i}`]
      if (url) {
        const name = process.env[`PORTAL_EXPORT_NAME_${i}`] || `Portal ${i}`
        portals.push({ id: String(i), name, url })
      }
    }

    // Backwards-compatible single portal env
    if (!portals.length && process.env.PORTAL_EXPORT_URL) {
      portals.push({ id: "default", name: process.env.PORTAL_EXPORT_NAME || "Portal", url: process.env.PORTAL_EXPORT_URL })
    }

    return NextResponse.json({ portals })
  } catch (err) {
    return NextResponse.json({ portals: [] })
  }
}
