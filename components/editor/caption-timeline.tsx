"use client"

import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"

interface CaptionTimelineProps {
  captions: any[]
  selectedCaption: string | null
  onSelectCaption: (id: string) => void
  currentTime: number
  onAddCaption: () => void
}

export function CaptionTimeline({
  captions,
  selectedCaption,
  onSelectCaption,
  currentTime,
  onAddCaption,
}: CaptionTimelineProps) {
  const formatTime = (seconds: number) => {
    const total = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0
    const mins = Math.floor(total / 60)
    const secs = Math.floor(total % 60)
    // centiseconds per requirement
    const cs = Math.floor((total % 1) * 100)

    const mStr = String(mins).padStart(2, "0")
    const sStr = String(secs).padStart(2, "0")
    const csStr = String(cs).padStart(2, "0")

    // Timeline format: mm:ss:cc (minutes:seconds:centiseconds)
    return `${mStr}:${sStr}:${csStr}`
  }

  return (
    <div className="border-t border-border p-4 bg-card/50 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Captions ({captions.length})</h3>
        <Button size="sm" onClick={onAddCaption} className="gap-2">
          <Plus className="w-4 h-4" />
          Add Caption
        </Button>
      </div>

      <div className="space-y-2 max-h-32 overflow-y-auto">
        {captions.map((caption) => (
          <div
            key={caption.id}
            onClick={() => onSelectCaption(caption.id)}
            className={`p-3 rounded-lg cursor-pointer transition-colors ${
              selectedCaption === caption.id
                ? "bg-primary/20 border border-primary"
                : "bg-secondary border border-border hover:border-primary/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium truncate">{caption.text}</p>
                <p className="text-xs text-muted-foreground">
                  {formatTime(caption.start_time)} - {formatTime(caption.end_time)}
                </p>
              </div>
              <div
                className={`w-1 h-12 rounded-full ${
                  currentTime >= caption.start_time && currentTime <= caption.end_time ? "bg-primary" : "bg-border"
                }`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
