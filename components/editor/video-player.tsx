"use client"

import { useRef, useEffect, useState, useMemo } from "react"
import { Play, Pause, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import { type CaptionSegment, type CaptionTemplate, type CaptionWord } from "@/lib/pipeline"
import { Templates } from "@/components/templates/data"
import { CanvasCaptionRenderer } from "@/components/editor/canvas-caption-renderer"
import { CreatorKineticOverlay } from "@/components/editor/creator-kinetic-overlay"

type PlayerCaption = CaptionSegment & {
  start_time?: number
  end_time?: number
}

interface VideoPlayerProps {
  videoUrl: string
  currentTime: number
  onTimeChange: (time: number) => void
  captions: PlayerCaption[]
  className?: string
  frameClassName?: string
  templatePreviewId?: string
  templateStyle?: CaptionTemplate
}

export function VideoPlayer({
  videoUrl,
  currentTime,
  onTimeChange,
  captions,
  className,
  frameClassName,
  templatePreviewId,
  templateStyle,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const [overlayTop, setOverlayTop] = useState<number | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateCurrentTime = () => {
      onTimeChange(video.currentTime)
    }

    const updateDuration = () => {
      setDuration(video.duration)
    }

    video.addEventListener("timeupdate", updateCurrentTime)
    video.addEventListener("loadedmetadata", updateDuration)

    return () => {
      video.removeEventListener("timeupdate", updateCurrentTime)
      video.removeEventListener("loadedmetadata", updateDuration)
    }
  }, [onTimeChange])

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = currentTime
    }
  }, [currentTime])

  const formatTime = (seconds: number) => {
    const total = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = Math.floor(total % 60)
    // centiseconds per requirement: Math.floor((seconds % 1) * 100)
    const cs = Math.floor((total % 1) * 100)

    const mStr = String(m).padStart(2, "0")
    const sStr = String(s).padStart(2, "0")
    const csStr = String(cs).padStart(2, "0")

    // Format: H:MM:SS.CC (hours not zero-padded)
    return `${h}:${mStr}:${sStr}.${csStr}`
  }

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
      setIsPlaying(!isPlaying)
    }
  }

  const templateObj = useMemo(() => {
    const id = templatePreviewId ?? (typeof templateStyle === "string" ? templateStyle : "minimal")
    return Templates[id] ?? Templates.minimal
  }, [templatePreviewId, templateStyle])

  const staticOverlayConfig = useMemo(() => ({ scale: 1, x: 50, y: 85 }), [])

  // Precompute overlay segments which contain the keywords 'money', 'rich', or 'wealth' (case-insensitive)
  const overlaySegments = useMemo(
    () => captions.filter((c) => /\b(money|rich|wealth)\b/i.test(c.text)),
    [captions]
  );

  // Find active overlay for currentTime
  const activeOverlay = useMemo(() => {
    return overlaySegments.find((s) => currentTime >= (s.start ?? 0) && currentTime <= (s.end ?? 0))
  }, [overlaySegments, currentTime])

  // Compute overlay top position based on video size and template margin
  useEffect(() => {
    const video = videoRef.current
    if (!video || !templateObj) {
      setOverlayTop(null)
      return
    }

    const computePos = () => {
      const height = video.videoHeight || video.clientHeight || 720
      let captionY = height - (templateObj.marginV ?? 40)
      if ((templateObj as any).alignment === 5) {
        captionY = height / 2
      }
      setOverlayTop(captionY)
    }

    computePos()
    window.addEventListener("resize", computePos)
    return () => window.removeEventListener("resize", computePos)
  }, [videoRef, templateObj])

  return (
    <div className={cn("p-6 space-y-4 flex-1 flex flex-col bg-card/50", className)}>
      <div
        className={cn(
          "flex-1 bg-black rounded-lg overflow-hidden relative flex items-center justify-center",
          frameClassName,
        )}
      >
        <video ref={videoRef} src={videoUrl} className="w-full h-full object-contain" muted={isMuted} />

        {/* Caption Overlay */}
        {templateObj.name === "CreatorKinetic" ? (
          <CreatorKineticOverlay videoRef={videoRef} captions={captions} config={staticOverlayConfig} />
        ) : (
          <CanvasCaptionRenderer
            videoRef={videoRef}
            captions={captions}
            template={templateObj}
            onCaptionPosition={({ y }) => setOverlayTop(y)}
          />
        )}

        {/* Play Button Overlay */}
        {!isPlaying && (
          <Button size="lg" variant="ghost" className="absolute rounded-full" onClick={togglePlay}>
            <Play className="w-12 h-12 text-white fill-white" />
          </Button>
        )}
        {activeOverlay && (
          <div
              className="absolute left-4 z-30 pointer-events-none"
              style={{
                top: typeof overlayTop === "number" ? `${overlayTop}px` : overlayTop ?? "50%",
                // end position lifted a bit higher so the riser finishes slightly above previous placement
                transform: "translateY(-60%)",
                width: 260, // slightly larger preview emoji
                maxWidth: "25%",
              }}
            >
              <img
                src="https://raw.githubusercontent.com/notankith/cloudinarytest/refs/heads/main/Money.gif"
                alt="overlay"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-2">
        <div className="flex items-center gap-4">
          <Button size="sm" variant="outline" onClick={togglePlay} className="gap-2 bg-transparent">
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4" />
                Pause
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Play
              </>
            )}
          </Button>

          <div className="flex-1">
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={(value) => onTimeChange(value[0])}
              className="w-full"
            />
          </div>

          <span className="text-sm text-muted-foreground min-w-12">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <Button size="sm" variant="outline" onClick={() => setIsMuted(!isMuted)}>
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}

