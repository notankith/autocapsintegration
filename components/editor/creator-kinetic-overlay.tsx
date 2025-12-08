"use client";

import React, { useEffect, useRef, useMemo, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { type CaptionSegment } from "@/lib/pipeline";
import { useThrottleFn } from "@/lib/hooks/useThrottleFn";
import { chunkWordsIntoSentences, getSentenceColor, type KineticWord, type KineticSentence } from "./kinetic-caption-utils";

export interface OverlayConfig {
  scale: number;
  x: number;
  y: number;
}

interface SentenceGroup {
  sentences: Array<{ sentence: KineticSentence; sentenceIndex: number }>;
}

const DEFAULT_CONFIG: OverlayConfig = { scale: 3.35, x: 50, y: 50 };
const PREVIEW_BASE_FONT_PX = 44;
const SENTENCES_PER_GROUP = 2;

interface CreatorKineticOverlayProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  captions: CaptionSegment[];
  wordsOverride?: KineticWord[];
  currentTime?: number;
  config?: OverlayConfig;
  onUpdateConfiguration?: (config: OverlayConfig) => void;
}

export function CreatorKineticOverlay({
  videoRef,
  captions,
  wordsOverride,
  currentTime,
  config = DEFAULT_CONFIG,
  onUpdateConfiguration,
}: CreatorKineticOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Refs to store DOM elements for direct manipulation (performance)
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const sentenceGroupRefs = useRef<(HTMLSpanElement | null)[]>([]);
  
  // State tracking refs (to avoid re-renders)
  const lastActiveWordIndex = useRef<number>(-1);
  const lastSentenceGroupIndex = useRef<number>(-1);

  // Helper to validate numbers
  const isValidNumber = (n: any): n is number => typeof n === "number" && !Number.isNaN(n) && Number.isFinite(n);

  const safeIncomingConfig = useMemo<OverlayConfig>(() => ({
    scale: isValidNumber(config?.scale) ? config!.scale : DEFAULT_CONFIG.scale,
    x: isValidNumber(config?.x) ? config!.x : DEFAULT_CONFIG.x,
    y: isValidNumber(config?.y) ? config!.y : DEFAULT_CONFIG.y,
  }), [config?.scale, config?.x, config?.y]);

  // Responsive scale state (based on video width)
  const [responsiveScale, setResponsiveScale] = useState(1);
  
  // Local interaction state (decoupled from parent to prevent lag)
  const [isInteracting, setIsInteracting] = useState(false);
  const [localConfig, setLocalConfig] = useState<OverlayConfig>(safeIncomingConfig);

  useEffect(() => {
    localConfigRef.current = safeIncomingConfig;
    setLocalConfig((prev) => ({
      ...prev,
      ...safeIncomingConfig,
    }));
  }, [safeIncomingConfig]);
  
  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialScaleRef = useRef<number>(1);
  const resizeDirectionRef = useRef<string>("");

  // Ref to access latest localConfig in event handlers without re-rendering
  const localConfigRef = useRef(localConfig);
  useEffect(() => {
    localConfigRef.current = localConfig;
  }, [localConfig]);

  const throttledUpdate = useThrottleFn(onUpdateConfiguration, 16);

  const overlayStyle = useMemo<React.CSSProperties>(() => ({
    position: "absolute",
    left: `${localConfig.x}%`,
    top: `${localConfig.y}%`,
    transform: `translate(-50%, -50%) scale(${localConfig.scale})`,
    cursor: onUpdateConfiguration ? (isInteracting ? "grabbing" : "grab") : "default",
    pointerEvents: onUpdateConfiguration ? "auto" : "none",
  }), [localConfig.x, localConfig.y, localConfig.scale, isInteracting, onUpdateConfiguration]);

  const applyLocalConfig = (partial: Partial<OverlayConfig>) => {
    const merged: OverlayConfig = { ...localConfigRef.current, ...partial };
    localConfigRef.current = merged;
    setLocalConfig(merged);
    return merged;
  };

  // Constants shared with preview player come from kinetic-caption-utils.ts

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!onUpdateConfiguration) return;
    // Only drag if clicking the container directly or text, not resize handles
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    
    e.preventDefault();
    setIsDragging(true);
    setIsInteracting(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    // Use local config for initial position
    initialPosRef.current = { 
      x: localConfig.x, 
      y: localConfig.y 
    };
  };

  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    if (!onUpdateConfiguration) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setIsInteracting(true);
    resizeDirectionRef.current = direction;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    initialScaleRef.current = localConfig.scale;
  };

  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!videoRef.current) return;
      
      if (isDragging) {
        const videoRect = videoRef.current.getBoundingClientRect();
        const deltaX = e.clientX - dragStartRef.current.x;
        const deltaY = e.clientY - dragStartRef.current.y;
        
        // Convert delta to percentage
        const deltaXPercent = (deltaX / videoRect.width) * 100;
        const deltaYPercent = (deltaY / videoRect.height) * 100;
        
        // Clamp to keep visible (0-100%)
        const newX = Math.max(0, Math.min(100, initialPosRef.current.x + deltaXPercent));
        const newY = Math.max(0, Math.min(100, initialPosRef.current.y + deltaYPercent));
        
        // Update local state immediately
        if (isValidNumber(newX) && isValidNumber(newY)) {
          const updated = applyLocalConfig({ x: newX, y: newY });
          throttledUpdate(updated);
        }
      } else if (isResizing) {
        const deltaY = dragStartRef.current.y - e.clientY; // Drag up = positive
        const deltaX = e.clientX - dragStartRef.current.x; // Drag right = positive
        
        let scaleDelta = 0;
        
        // Adjust scale logic based on corner
        if (resizeDirectionRef.current.includes('top')) {
           scaleDelta += deltaY * 0.01;
        } else {
           scaleDelta -= deltaY * 0.01;
        }
        
        if (resizeDirectionRef.current.includes('right')) {
           scaleDelta += deltaX * 0.01;
        } else {
           scaleDelta -= deltaX * 0.01;
        }
        
        const newScale = Math.max(0.2, Math.min(5, initialScaleRef.current + scaleDelta));
        
        // Update local state immediately
        if (isValidNumber(newScale)) {
          const updated = applyLocalConfig({ scale: newScale });
          throttledUpdate(updated);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setIsInteracting(false);
      
      // Commit changes to parent on mouse up using the ref
      if (onUpdateConfiguration) {
        onUpdateConfiguration(localConfigRef.current);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, isResizing, videoRef, onUpdateConfiguration, throttledUpdate]); 

  const handleWheel = (e: React.WheelEvent) => {
    if (!onUpdateConfiguration || !e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    
    const delta = e.deltaY * -0.001;
    const newScale = Math.max(0.5, Math.min(3, localConfig.scale + delta));
    const updated = applyLocalConfig({ scale: newScale });
    throttledUpdate(updated);
  };

  const flattenedWords = useMemo<KineticWord[]>(() => {
    if (wordsOverride && wordsOverride.length) {
      return wordsOverride;
    }

    const words: KineticWord[] = [];
    captions.forEach((segment) => {
      const segmentWords = segment.words && segment.words.length > 0
        ? segment.words
        : (() => {
            const tokens = segment.text
              .split(/\s+/)
              .map((token) => token.trim())
              .filter(Boolean);

            if (!tokens.length) {
              return [{ text: segment.text, start: segment.start, end: segment.end }];
            }

            const duration = Math.max(segment.end - segment.start, 0.1);
            const perToken = duration / tokens.length;

            return tokens.map((token, index) => ({
              text: token,
              start: segment.start + perToken * index,
              end: segment.start + perToken * (index + 1),
            }));
          })();
      segmentWords.forEach((w) => {
        words.push({
          text: w.text,
          startSec: w.start,
          endSec: w.end
        });
      });
    });
    return words;
  }, [captions, wordsOverride]);

  // Pre-process transcript: Group words into sentences with shared utility
  const { processedWords, sentences } = useMemo(() => {
    const processed = flattenedWords;
    const bounds: KineticSentence[] = [];

    if (processed.length) {
      let cursor = 0;
      captions.forEach((segment) => {
        const segmentStart = segment.start;
        const segmentEnd = segment.end;
        while (cursor < processed.length && processed[cursor].endSec <= segmentStart) {
          cursor++;
        }

        const startIndex = cursor;

        while (cursor < processed.length && processed[cursor].startSec < segmentEnd) {
          cursor++;
        }

        const endIndex = cursor - 1;

        if (endIndex >= startIndex && startIndex < processed.length) {
          bounds.push({ startWordIndex: startIndex, endWordIndex: endIndex });
        }
      });

      if (!bounds.length) {
        bounds.push(...chunkWordsIntoSentences(processed).sentences);
      }

      if (bounds.length && bounds[bounds.length - 1].endWordIndex < processed.length - 1) {
        bounds[bounds.length - 1].endWordIndex = processed.length - 1;
      }
    }

    const finalResult = bounds.length
      ? { processedWords: processed, sentences: bounds }
      : chunkWordsIntoSentences(processed);

    lastActiveWordIndex.current = -1;
    lastSentenceGroupIndex.current = -1;
    wordRefs.current = [];
    sentenceGroupRefs.current = [];

    return finalResult;
  }, [flattenedWords, captions]);

  const sentenceGroups = useMemo<SentenceGroup[]>(() => {
    const groups: SentenceGroup[] = [];
    for (let i = 0; i < sentences.length; i += SENTENCES_PER_GROUP) {
      const chunk = sentences.slice(i, i + SENTENCES_PER_GROUP);
      if (!chunk.length) continue;
      groups.push({
        sentences: chunk.map((sentence, offset) => ({ sentence, sentenceIndex: i + offset })),
      });
    }
    return groups;
  }, [sentences]);

  const sentenceToGroupIndex = useMemo(() => {
    const map: number[] = [];
    sentenceGroups.forEach((group, groupIdx) => {
      group.sentences.forEach(({ sentenceIndex }) => {
        map[sentenceIndex] = groupIdx;
      });
    });
    return map;
  }, [sentenceGroups]);

  // Force re-render when captions change to ensure DOM refs are re-bound
  const [_, setForceUpdate] = useState(0);
  useEffect(() => {
    setForceUpdate(n => n + 1);
  }, [captions]);

  // Handle scaling based on video size
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const updateScale = () => {
      const currentWidth = video.clientWidth;
      // Reference width is 1920 (from lib/captions.ts PlayResX)
      if (currentWidth > 0) {
        setResponsiveScale(currentWidth / 1920);
      }
    };

    // Initial scale
    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(video);

    return () => observer.disconnect();
  }, [videoRef]);

  const updateActiveWordAtTime = useCallback((time: number) => {
    let activeIndex = -1;

    for (let i = 0; i < processedWords.length; i++) {
      const { startSec, endSec } = processedWords[i];
      if (time >= startSec && time < endSec) {
        activeIndex = i;
        break;
      }
    }

    if (activeIndex !== lastActiveWordIndex.current) {
      if (lastActiveWordIndex.current !== -1) {
        const prevEl = wordRefs.current[lastActiveWordIndex.current];
        if (prevEl) {
          prevEl.classList.remove("active", "blue", "yellow", "green");
        }
      }

      if (activeIndex === -1) {
        if (lastSentenceGroupIndex.current !== -1) {
          const prevGroup = sentenceGroupRefs.current[lastSentenceGroupIndex.current];
          if (prevGroup) {
            prevGroup.classList.remove("visible", "zoom-in");
          }
        }
        lastActiveWordIndex.current = -1;
        lastSentenceGroupIndex.current = -1;
      } else {
        const activeEl = wordRefs.current[activeIndex];
        const sentenceIndex = sentences.findIndex(
          (s) => activeIndex >= s.startWordIndex && activeIndex <= s.endWordIndex
        );
        const groupIndex = sentenceIndex !== -1 ? sentenceToGroupIndex[sentenceIndex] ?? -1 : -1;

        if (activeEl && sentenceIndex !== -1) {
          const color = getSentenceColor(sentenceIndex);
          activeEl.classList.add("active", color);
        }

        if (groupIndex !== lastSentenceGroupIndex.current) {
          if (lastSentenceGroupIndex.current !== -1) {
            const prevGroup = sentenceGroupRefs.current[lastSentenceGroupIndex.current];
            if (prevGroup) {
              prevGroup.classList.remove("visible", "zoom-in");
            }
          }

          if (groupIndex !== -1) {
            const newGroup = sentenceGroupRefs.current[groupIndex];
            if (newGroup) {
              newGroup.classList.add("visible");
              newGroup.classList.remove("zoom-in");
              void newGroup.offsetWidth;
              newGroup.classList.add("zoom-in");
            }
          }

          lastSentenceGroupIndex.current = groupIndex;
        }

        lastActiveWordIndex.current = activeIndex;
      }
    }
  }, [processedWords, sentences, sentenceToGroupIndex]);

  useEffect(() => {
    if (typeof currentTime === "number") {
      updateActiveWordAtTime(currentTime);
    }
  }, [currentTime, updateActiveWordAtTime]);

  // Animation loop for smooth playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video && typeof currentTime !== "number") return;

    let animationFrameId: number;

    const tick = () => {
      const sourceTime = video ? video.currentTime : currentTime ?? 0;
      updateActiveWordAtTime(sourceTime);
      if (video) {
        if (!video.paused && !video.ended) {
          animationFrameId = requestAnimationFrame(tick);
        }
      } else {
        animationFrameId = requestAnimationFrame(tick);
      }
    };

    const onPlay = () => {
      animationFrameId = requestAnimationFrame(tick);
    };

    const onPause = () => {
      cancelAnimationFrame(animationFrameId);
      if (video) {
        updateActiveWordAtTime(video.currentTime);
      }
    };

    const onSeeked = () => {
      if (video) {
        updateActiveWordAtTime(video.currentTime);
      }
    };

    const onEnded = () => {
      cancelAnimationFrame(animationFrameId);
      if (lastActiveWordIndex.current !== -1) {
        const prevEl = wordRefs.current[lastActiveWordIndex.current];
        if (prevEl) prevEl.classList.remove("active", "blue", "yellow", "green");
      }
      if (lastSentenceGroupIndex.current !== -1) {
        const prevSentenceEl = sentenceGroupRefs.current[lastSentenceGroupIndex.current];
        if (prevSentenceEl) prevSentenceEl.classList.remove("visible", "zoom-in");
      }
      lastActiveWordIndex.current = -1;
      lastSentenceGroupIndex.current = -1;
    };

    if (video) {
      video.addEventListener("play", onPlay);
      video.addEventListener("pause", onPause);
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("ended", onEnded);
      updateActiveWordAtTime(video.currentTime);
      if (!video.paused && !video.ended) {
        animationFrameId = requestAnimationFrame(tick);
      }
    } else {
      animationFrameId = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (video) {
        video.removeEventListener("play", onPlay);
        video.removeEventListener("pause", onPause);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("ended", onEnded);
      }
    };
  }, [currentTime, updateActiveWordAtTime, videoRef]);

  return (
    <>
      <style jsx>{`
        @font-face {
          font-family: "TheBoldFont";
          src: url("/fonts/THEBOLDFONT-FREEVERSION.ttf") format("truetype");
          font-weight: normal;
          font-style: normal;
        }

        .captions-overlay-container {
          --caption-font-size: calc(${PREVIEW_BASE_FONT_PX}px * ${responsiveScale});
          --caption-zoom-duration: 0.3s;
          --highlight-blue: #70e2ff;
          --highlight-yellow: #ffe83f;
          --highlight-green: #9fff5b;
          --caption-outline-color: #000000;

          width: max-content;
          min-width: 0;
          text-align: center;
          text-transform: uppercase;
          font-size: var(--caption-font-size);
          font-family: "TheBoldFont", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          line-height: 1.1;
          z-index: 20;
          user-select: none;
          border: ${onUpdateConfiguration ? "1px dashed rgba(255, 255, 255, 0.5)" : "none"};
          padding: calc(var(--caption-font-size) * 0.35);
          border-radius: 8px;
          transition: border-color 0.2s;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
        }

        .captions-overlay-container.interacting {
          border-color: rgba(255, 255, 255, 0.9);
          background: rgba(0, 0, 0, 0.2);
        }

        .captions-overlay-container:hover {
          border-color: ${onUpdateConfiguration ? "rgba(255, 255, 255, 0.9)" : "transparent"};
          background: ${onUpdateConfiguration ? "rgba(0, 0, 0, 0.2)" : "transparent"};
        }

        .resize-handle {
          position: absolute;
          width: 12px;
          height: 12px;
          background: white;
          border: 1px solid black;
          border-radius: 50%;
          z-index: 30;
          cursor: ns-resize;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .captions-overlay-container:hover .resize-handle,
        .captions-overlay-container.interacting .resize-handle {
          opacity: 1;
        }

        .resize-handle.top-left { top: -6px; left: -6px; cursor: nwse-resize; }
        .resize-handle.top-right { top: -6px; right: -6px; cursor: nesw-resize; }
        .resize-handle.bottom-left { bottom: -6px; left: -6px; cursor: nesw-resize; }
        .resize-handle.bottom-right { bottom: -6px; right: -6px; cursor: nwse-resize; }

        .sentence-group {
          display: none;
          flex-direction: column;
          gap: calc(var(--caption-font-size) * 0.05);
          align-items: center;
          transform-origin: center center;
        }

        .sentence-group.visible {
          display: flex;
        }

        .sentence-group.zoom-in {
          animation: sentence-zoom var(--caption-zoom-duration) ease-out;
        }

        .sentence-line {
          white-space: pre-wrap;
          text-align: center;
        }

        @keyframes sentence-zoom {
          0% { transform: scale(0.9); }
          100% { transform: scale(1); }
        }

        .word {
          position: relative;
          display: inline-block;
          color: #ffffff;
          text-shadow:
            0 0 calc(2px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(4px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(6px * ${responsiveScale}) rgba(0, 0, 0, 0.85),
            0 0 calc(3px * ${responsiveScale}) #ffffffaa,
            0 0 calc(6px * ${responsiveScale}) #ffffffaa,
            0 0 calc(12px * ${responsiveScale}) #ffffffaa;
        }

        .word + .word {
          margin-left: 0.14em;
        }

        .word.active {
          text-shadow:
            0 0 calc(2px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(4px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(8px * ${responsiveScale}) rgba(0, 0, 0, 0.95),
            0 0 calc(6px * ${responsiveScale}) currentColor,
            0 0 calc(12px * ${responsiveScale}) currentColor,
            0 0 calc(10px * ${responsiveScale}) currentColor;
        }

        .word.active.blue { 
          color: var(--highlight-blue);
          text-shadow:
            0 0 calc(2px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(4px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(8px * ${responsiveScale}) rgba(0, 0, 0, 0.95),
            0 0 calc(6px * ${responsiveScale}) var(--highlight-blue),
            0 0 calc(12px * ${responsiveScale}) var(--highlight-blue),
            0 0 calc(16px * ${responsiveScale}) rgba(112, 226, 255, 0.2);
        }

        .word.active.yellow { 
          color: var(--highlight-yellow);
          text-shadow:
            0 0 calc(2px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(4px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(8px * ${responsiveScale}) rgba(0, 0, 0, 0.95),
            0 0 calc(6px * ${responsiveScale}) var(--highlight-yellow),
            0 0 calc(12px * ${responsiveScale}) var(--highlight-yellow),
            0 0 calc(16px * ${responsiveScale}) rgba(255, 232, 63, 0.2);
        }

        .word.active.green { 
          color: var(--highlight-green);
          text-shadow:
            0 0 calc(2px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(4px * ${responsiveScale}) var(--caption-outline-color),
            0 0 calc(8px * ${responsiveScale}) rgba(0, 0, 0, 0.95),
            0 0 calc(6px * ${responsiveScale}) var(--highlight-green),
            0 0 calc(12px * ${responsiveScale}) var(--highlight-green),
            0 0 calc(16px * ${responsiveScale}) rgba(159, 255, 91, 0.2);
        }
      `}</style>

      <div
        ref={containerRef}
        className={cn("captions-overlay-container", isInteracting && "interacting")}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        style={overlayStyle}
      >
        {onUpdateConfiguration && (
          <>
            <div className="resize-handle top-left" onMouseDown={(e) => handleResizeStart(e, 'top-left')} />
            <div className="resize-handle top-right" onMouseDown={(e) => handleResizeStart(e, 'top-right')} />
            <div className="resize-handle bottom-left" onMouseDown={(e) => handleResizeStart(e, 'bottom-left')} />
            <div className="resize-handle bottom-right" onMouseDown={(e) => handleResizeStart(e, 'bottom-right')} />
          </>
        )}
        {sentenceGroups.map((group, groupIdx) => (
          <span
            key={groupIdx}
            className="sentence-group"
            ref={(el) => {
              sentenceGroupRefs.current[groupIdx] = el;
            }}
          >
            {group.sentences.map(({ sentence, sentenceIndex }) => (
              <span key={sentenceIndex} className="sentence-line">
                {processedWords
                  .slice(sentence.startWordIndex, sentence.endWordIndex + 1)
                  .map((word, wIdx) => {
                    const globalIndex = sentence.startWordIndex + wIdx;
                    return (
                      <span
                        key={globalIndex}
                        className="word"
                        data-index={globalIndex}
                        data-start={word.startSec}
                        data-end={word.endSec}
                        ref={(el) => {
                          wordRefs.current[globalIndex] = el;
                        }}
                      >
                        {word.text}
                      </span>
                    );
                  })}
              </span>
            ))}
          </span>
        ))}
      </div>
    </>
  );
}
