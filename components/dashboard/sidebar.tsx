"use client"

import { Home, Clock, Settings, LogOut, Zap } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Button } from "@/components/ui/button"

const menuItems = [
  { icon: Home, label: "Dashboard", href: "/dashboard" },
  { icon: Clock, label: "History", href: "/dashboard/history" },
  { icon: Zap, label: "Pricing", href: "/dashboard/pricing" },
  { icon: Settings, label: "Settings", href: "/dashboard/settings" },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <div className="w-64 border-r border-border bg-card flex flex-col h-full">
      <div className="p-6 border-b border-border">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold text-xl">
          <Zap className="w-6 h-6 text-primary" />
          AutoCaps
        </Link>
      </div>

      <nav className="flex-1 p-6 space-y-2">
        {menuItems.map((item) => (
          <Link key={item.href} href={item.href}>
            <Button variant={pathname === item.href ? "default" : "ghost"} className="w-full justify-start gap-3">
              <item.icon className="w-5 h-5" />
              {item.label}
            </Button>
          </Link>
        ))}
      </nav>

      <div className="p-6 border-t border-border">
        <Button
          variant="outline"
          className="w-full justify-start gap-3 bg-transparent"
          onClick={async () => {
            try {
              await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" })
            } catch (err) {
              // Intentionally fall through to redirect even if logout API fails
              console.warn("Logout request failed", err)
            } finally {
              // Strict redirect to login page
              window.location.href = "/auth/login"
            }
          }}
        >
          <LogOut className="w-5 h-5" />
          Logout
        </Button>
      </div>
    </div>
  )
}
