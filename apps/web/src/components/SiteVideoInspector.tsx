import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Circle,
  FileVideo,
  Layers,
  ListChecks,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Square
} from "lucide-react";
import { Button } from "./ui.js";
import { apiFetch } from "../lib/api.js";

const MAX_SECONDS = 60;
const MAX_BYTES = 18 * 1024 * 1024;
const MAX_ROUNDS = 5;

export interface SiteObservation {
  label: string;
  detail: string;
  timestamp?: string | null;
  severity: "info" | "low" | "medium" | "high";
}

export interface SiteInspectionOutput {
  assessment: "issue_confirmed" | "issue_partially_visible" | "not_visible" | "unusable_footage";
  confidence: number;
  summary: string;
  observations: SiteObservation[];
  safety_flags: Array<{ hazard: string; urgency: "monitor" | "soon" | "immediate" }>;
  urgent_hazard: boolean;
  missing_footage: Array<{ shot: string; reason: string }>;
  recommended_next_steps: string[];
  status_update: string;
  context_brief: string;
  round: number;
  rounds_remaining: number;
  disclaimer: string;
  guardrail_notes: string[];
  context_chars?: number;
}

export interface StoredSiteInspectionState {
  context_brief: string;
  latest: SiteInspectionOutput | null;
  rounds: Array<{
    round: number;
    evidenceId: string;
    assessment: string;
    confidence: number;
    status_update: string;
    urgent_hazard: boolean;
    createdAt: number;
  }>;
}

interface CaptureSession {
  nonce: string;
  expiresAt: number;
  sig: string;
  maxSeconds: number;
}

interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number;
}

const ASSESSMENT_LABEL: Record<SiteInspectionOutput["assessment"], string> = {
  issue_confirmed: "Issue confirmed on video",
  issue_partially_visible: "Partly visible",
  not_visible: "Not visible in footage",
  unusable_footage: "Footage not usable"
};

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function pickRecorderMime(): string {
  const candidates = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

function severityStyle(severity: SiteObservation["severity"]): string {
  if (severity === "high") {
    return "bg-[var(--reopened-bg)] text-[var(--reopened-fg)] border-[var(--reopened-border)]";
  }
  if (severity === "medium") {
    return "bg-[var(--disputed-bg)] text-[var(--disputed-fg)] border-[var(--disputed-border)]";
  }
  if (severity === "low") {
    return "bg-[var(--accent-soft)] text-[var(--accent)] border-transparent";
  }
  return "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-hairline)]";
}

function requestCurrentGps(): Promise<GpsFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("GPS geolocation is required for live recording, but this browser does not support it."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
      (err) =>
        reject(
          new Error(
            err.message ||
              "Location access is required to verify live video recordings and prevent manipulated gallery uploads."
          )
        ),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
    );
  });
}

export function SiteVideoInspector({
  ticketId,
  requestedShots,
  storedState,
  onEvaluated
}: {
  ticketId: string;
  requestedShots: string[];
  storedState: StoredSiteInspectionState | null;
  onEvaluated: () => Promise<void>;
}) {
  const [clip, setClip] = useState<File | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [captureSession, setCaptureSession] = useState<CaptureSession | null>(null);
  const [gpsFix, setGpsFix] = useState<GpsFix | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveResult, setLiveResult] = useState<SiteInspectionOutput | null>(null);

  const liveRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const latest = liveResult ?? storedState?.latest ?? null;
  const completedRounds = storedState?.rounds.length ?? 0;
  const nextRound = completedRounds + 1;
  const canSubmitMore = nextRound <= MAX_ROUNDS;

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (liveRef.current) liveRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    setClip(null);
    setClipUrl(null);
    setCaptureSession(null);
    setGpsFix(null);
    setDurationMs(0);
    setLiveResult(null);
    setError(null);
    setCameraError(null);
  }, [ticketId]);

  useEffect(() => {
    return () => {
      stopStream();
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [stopStream]);

  useEffect(() => {
    return () => {
      if (clipUrl) URL.revokeObjectURL(clipUrl);
    };
  }, [clipUrl]);

  const setClipFile = (file: File | null) => {
    setError(null);
    if (file && file.size > MAX_BYTES) {
      setError("Recording is larger than 18 MB. Record a shorter clip.");
      return;
    }
    setClip(file);
    setClipUrl(file ? URL.createObjectURL(file) : null);
  };

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (startedAtRef.current > 0) {
      setDurationMs(Date.now() - startedAtRef.current);
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  const startRecording = async () => {
    setCameraError(null);
    setError(null);
    setPreparing(true);
    try {
      const gps = await requestCurrentGps();
      const session = await apiFetch<CaptureSession>(
        `/api/v1/intake/${ticketId}/video-capture/start`,
        { method: "POST" }
      );
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: true
      });
      setGpsFix(gps);
      setCaptureSession(session);
      streamRef.current = stream;
      if (liveRef.current) {
        liveRef.current.srcObject = stream;
        await liveRef.current.play().catch(() => undefined);
      }
      const mimeType = pickRecorderMime();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 1_500_000
      });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type });
        const ext = type.includes("mp4") ? "mp4" : "webm";
        setClipFile(new File([blob], `live-site-r${nextRound}.${ext}`, { type: type.split(";")[0] }));
        stopStream();
      };
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.start(1000);
      setElapsed(0);
      setRecording(true);
      const limitSec = session.maxSeconds || MAX_SECONDS;
      timerRef.current = window.setInterval(() => {
        setElapsed((prev) => {
          if (prev + 1 >= limitSec) {
            stopRecording();
            return limitSec;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      stopStream();
      setCameraError(
        err instanceof Error
          ? err.message
          : "Live camera and GPS location permission are required."
      );
    } finally {
      setPreparing(false);
    }
  };

  const handleEvaluate = async () => {
    if (!clip || !captureSession || !gpsFix) return;
    setSubmitting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("video", clip);
      form.append("captureNonce", captureSession.nonce);
      form.append("captureExpiresAt", String(captureSession.expiresAt));
      form.append("captureSig", captureSession.sig);
      form.append("durationMs", String(Math.max(durationMs, elapsed * 1000)));
      form.append("lat", String(gpsFix.lat));
      form.append("lng", String(gpsFix.lng));
      form.append("accuracy", String(gpsFix.accuracy));

      const res = await apiFetch<{ inspection: SiteInspectionOutput }>(
        `/api/v1/intake/${ticketId}/video-inspection`,
        {
          method: "POST",
          body: form
        }
      );
      setLiveResult(res.inspection);
      setClipFile(null);
      setCaptureSession(null);
      await onEvaluated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not evaluate live video");
    } finally {
      setSubmitting(false);
    }
  };

  const shots =
    latest?.missing_footage && latest.missing_footage.length > 0
      ? latest.missing_footage.map((m) => `${m.shot} — ${m.reason}`)
      : requestedShots;

  return (
    <div className="rounded-2xl border border-[var(--border-strong)] bg-[var(--bg-surface)] p-4 sm:p-5 space-y-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
            <Camera className="w-3.5 h-3.5" />
            <span>Live GPS-Verified Video Capture</span>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Visual proof is required. Gallery images and pre-recorded uploads are disabled to prevent manipulation—record live on site within {MAX_SECONDS}s.
          </p>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-[11px] font-medium text-[var(--text-muted)]">
          Round {Math.min(nextRound, MAX_ROUNDS)} / {MAX_ROUNDS}
        </span>
      </div>

      {shots.length > 0 && (
        <div className="silk-subtle p-3.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
            <ListChecks className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>{latest?.missing_footage?.length ? "Footage requested for this round" : "Shots to include in your live video"}</span>
          </div>
          <ul className="space-y-1.5">
            {shots.map((shot) => (
              <li key={shot} className="flex gap-2 text-xs text-[var(--text-secondary)] leading-relaxed">
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--text-muted)]" />
                <span>{shot}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canSubmitMore && (
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden bg-[var(--bg-subtle)] border border-[var(--border-hairline)] aspect-video flex items-center justify-center">
            <video
              ref={liveRef}
              muted
              playsInline
              className={`absolute inset-0 w-full h-full object-cover ${recording ? "" : "hidden"}`}
            />
            {!recording && clipUrl && (
              <video
                src={clipUrl}
                controls
                playsInline
                className="absolute inset-0 w-full h-full object-contain bg-black"
              />
            )}
            {!recording && !clipUrl && (
              <div className="text-center space-y-1.5 px-6">
                <Camera className="w-7 h-7 mx-auto text-[var(--text-muted)]" />
                <p className="text-xs text-[var(--text-muted)]">
                  Live camera only · max {MAX_SECONDS}s · GPS stamped
                </p>
              </div>
            )}
            {recording && (
              <div className="absolute top-3 left-3 inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                {formatClock(elapsed)} / {formatClock(MAX_SECONDS)}
              </div>
            )}
          </div>

          {gpsFix && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--verified-bg)] border border-[var(--verified-border)] text-[var(--verified-fg)] text-[11px] font-medium">
              <MapPin className="w-3 h-3" />
              <span>
                GPS locked ({gpsFix.lat.toFixed(4)}, {gpsFix.lng.toFixed(4)} · ±{Math.round(gpsFix.accuracy)}m)
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!recording ? (
              <Button size="sm" onClick={() => void startRecording()} disabled={submitting || preparing}>
                <Circle className="w-3.5 h-3.5 fill-current" />
                <span>
                  {preparing
                    ? "Locking GPS & camera..."
                    : clip
                      ? "Re-record live video"
                      : "Start live recording"}
                </span>
              </Button>
            ) : (
              <Button size="sm" variant="danger" onClick={stopRecording}>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop recording</span>
              </Button>
            )}

            {clip && !recording && (
              <Button
                size="sm"
                variant="subtle"
                onClick={() => void handleEvaluate()}
                disabled={submitting}
              >
                <FileVideo className="w-3.5 h-3.5" />
                <span>{submitting ? "Evaluating live video..." : "Submit live recording for AI review"}</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {cameraError && (
        <div className="p-3 rounded-xl border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] text-xs">
          {cameraError}
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-xs">
          {error}
        </div>
      )}

      {latest && (
        <div className="pt-3 border-t border-[var(--border-hairline)] space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                AI Video Evaluation · Round {latest.round}
              </div>
              <div className="text-sm font-bold text-[var(--text-primary)]">
                {ASSESSMENT_LABEL[latest.assessment]}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hairline)] font-semibold tabular-nums">
                Confidence {Math.round(latest.confidence * 100)}%
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[var(--bg-subtle)] border border-[var(--border-hairline)] text-[11px] text-[var(--text-muted)]">
                <Layers className="w-3 h-3" />
                <span>Context {latest.context_brief.length}/900 chars</span>
              </span>
            </div>
          </div>

          {latest.urgent_hazard && (
            <div className="flex gap-2 p-3 rounded-xl border border-[var(--reopened-border)] bg-[var(--reopened-bg)] text-[var(--reopened-fg)] text-xs leading-relaxed">
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Potential immediate hazard detected. Keep a safe distance from the site and contact local emergency services if anyone is at risk.
              </span>
            </div>
          )}

          <p className="text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed">
            {latest.summary}
          </p>

          <div className="silk-subtle p-3 text-xs text-[var(--text-secondary)]">
            <span className="font-semibold text-[var(--text-primary)]">Status Update: </span>
            {latest.status_update}
          </div>

          {latest.observations.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Observations
              </div>
              {latest.observations.map((obs, idx) => (
                <div key={`${obs.label}-${idx}`} className="flex gap-2 items-start text-xs">
                  <span
                    className={`mt-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize shrink-0 ${severityStyle(
                      obs.severity
                    )}`}
                  >
                    {obs.severity}
                  </span>
                  <div className="leading-relaxed">
                    <span className="font-semibold text-[var(--text-primary)]">{obs.label}</span>
                    {obs.timestamp ? (
                      <span className="text-[var(--text-muted)]"> · {obs.timestamp}</span>
                    ) : null}
                    <div className="text-[var(--text-secondary)]">{obs.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {latest.missing_footage.length > 0 && (
            <div className="p-3 rounded-xl border border-[var(--disputed-border)] bg-[var(--disputed-bg)] text-[var(--disputed-fg)] space-y-1.5 text-xs">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Footages still needed</span>
              </div>
              <ul className="list-disc pl-4 space-y-0.5">
                {latest.missing_footage.map((item, idx) => (
                  <li key={`${item.shot}-${idx}`}>
                    <strong>{item.shot}:</strong> {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {latest.recommended_next_steps.length > 0 && (
            <div className="space-y-1 text-xs">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Recommended Next Steps
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-[var(--text-secondary)]">
                {latest.recommended_next_steps.map((step, idx) => (
                  <li key={idx}>{step}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)] leading-relaxed pt-1">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--accent)]" />
            <span>{latest.disclaimer}</span>
          </div>
        </div>
      )}
    </div>
  );
}
