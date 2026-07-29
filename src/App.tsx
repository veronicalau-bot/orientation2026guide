import { useEffect, useRef, useState, type ChangeEvent } from "react"
import tourStopsData from "./data/tour-stops.json"
import { ensureAnonymousAuth } from "./lib/firebase"
import { uploadFavouriteSubmission } from "./lib/submission"
import { deleteSubmission, fetchSessionSubmissions, type GallerySubmission } from "./lib/gallery"

const GALLERY_PASSCODE = "8510"

// ─── Data ────────────────────────────────────────────────────────────────────

interface TourStop {
  id: number
  nameZh: string
  nameEn: string
  locationZh: string
  locationEn: string
  descriptionZh: string
  descriptionEn: string
  tipZh: string
  tipEn: string
  imageUrl: string
  imageAlt: string
}

interface SessionOption {
  id: string
  zh: string
  en: string
}

type GroupId = "A" | "B" | "C" | "D"

type Screen = "checkin" | "tour" | "stop-photo" | "favourite-photo" | "complete"

const SESSIONS: SessionOption[] = [
  { id: "morning", zh: "上午迎新時段（9:00）", en: "Morning Orientation (9:00 AM)" },
  { id: "noon", zh: "中午迎新時段（12:00）", en: "Midday Orientation (12:00 PM)" },
  { id: "afternoon", zh: "下午迎新時段（2:30）", en: "Afternoon Orientation (2:30 PM)" },
  { id: "evening", zh: "傍晚迎新時段（5:00）", en: "Evening Orientation (5:00 PM)" },
]

const TOUR_STOPS = tourStopsData as TourStop[]
const STOP_BY_ID = new Map(TOUR_STOPS.map((item) => [item.id, item]))
const GROUP_ORDER: GroupId[] = ["A", "B", "C", "D"]

const GROUP_ROUTES: Record<GroupId, number[]> = {
  A: [1, 2, 3, 4, 5, 6, 7],
  B: [3, 4, 5, 6, 7, 1, 2],
  C: [5, 6, 7, 1, 2, 3, 4],
  D: [7, 1, 2, 3, 4, 5, 6],
}

function firstName(name: string) {
  const parts = name.trim().split(/\s+/)
  return parts[0] || name
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "發生未知錯誤，請重試。"
}

function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, base64] = dataUrl.split(",")
  const mimeMatch = header.match(/data:(.*?);base64/)
  const mimeType = mimeMatch?.[1] ?? "image/jpeg"
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new File([bytes], filename, { type: mimeType })
}

async function savePhotoToDevice(dataUrl: string, filename: string) {
  const file = dataUrlToFile(dataUrl, filename)
  const shareNavigator = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>
  }

  if (shareNavigator.share && shareNavigator.canShare?.({ files: [file] })) {
    await shareNavigator.share({
      files: [file],
      title: "Library orientation photo",
      text: "Save your library orientation photo.",
    })
    return
  }

  const objectUrl = URL.createObjectURL(file)
  const link = document.createElement("a")
  link.href = objectUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

function getGroupByCheckInNumber(checkInNumber: number): GroupId {
  const index = Math.max(0, checkInNumber - 1)
  return GROUP_ORDER[index % GROUP_ORDER.length]
}

function getRouteStops(groupId: GroupId): TourStop[] {
  return GROUP_ROUTES[groupId]
    .map((stopId) => STOP_BY_ID.get(stopId))
    .filter((stop): stop is TourStop => Boolean(stop))
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5 px-5 py-3">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="flex-1 transition-all duration-500"
          style={{
            height: 3,
            borderRadius: 2,
            backgroundColor:
              i < current ? "#c4793a" : i === current ? "#c4793a60" : "#1e3a2f20",
          }}
        />
      ))}
    </div>
  )
}

function PhotoCapture({
  label,
  photo,
  onCapture,
}: {
  label: string
  photo: string | null
  onCapture: (dataUrl: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isSavingPhoto, setIsSavingPhoto] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSaveError(null)
    const reader = new FileReader()
    reader.onload = (ev) => onCapture(ev.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleSavePhoto = async () => {
    if (!photo) {
      return
    }

    setIsSavingPhoto(true)
    setSaveError(null)

    try {
      await savePhotoToDevice(photo, `library-orientation-${Date.now()}.jpg`)
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return
      }
      setSaveError("無法直接儲存，請改用手機的分享或下載功能重試。")
    } finally {
      setIsSavingPhoto(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={() => inputRef.current?.click()}
        className="w-full relative overflow-hidden transition-all active:scale-98"
        style={{
          height: 240,
          borderRadius: 14,
          backgroundColor: "#1e3a2f10",
          border: photo ? "3px solid #c4793a" : "2px dashed #c4793a60",
        }}
      >
        {photo ? (
          <>
            <img src={photo} alt="你的打卡照片 / Your check-in photo" className="w-full h-full object-cover" />
            <div
              className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
              style={{ backgroundColor: "#1e3a2f80" }}
            >
              <span className="text-sm font-semibold" style={{ color: "#faf7f2", fontFamily: "var(--font-body)" }}>
                重新拍攝 / Retake
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6">
            <span style={{ fontSize: 44 }}>🤳</span>
            <p className="text-sm text-center whitespace-pre-line" style={{ color: "#7a6e5f", fontFamily: "var(--font-body)", lineHeight: 1.5 }}>
              {label}
            </p>
          </div>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />

      <button
        onClick={() => inputRef.current?.click()}
        className="w-full py-3.5 text-sm font-semibold transition-all active:scale-95"
        style={{
          fontFamily: "var(--font-body)",
          backgroundColor: photo ? "#2d5242" : "#c4793a",
          color: "#faf7f2",
          borderRadius: 10,
          letterSpacing: "0.04em",
        }}
      >
        {photo ? "📷  重新拍攝 / Retake Photo" : "📸  拍照或自拍 / Take Photo or Selfie"}
      </button>

      {photo && (
        <>
          <button
            onClick={() => void handleSavePhoto()}
            disabled={isSavingPhoto}
            className="w-full py-3 text-sm font-semibold transition-all active:scale-95 disabled:opacity-60"
            style={{
              fontFamily: "var(--font-body)",
              backgroundColor: "#faf7f2",
              color: "#1e3a2f",
              borderRadius: 10,
              border: "1.5px solid #2d5242",
              letterSpacing: "0.03em",
            }}
          >
            {isSavingPhoto ? "儲存中… / Saving…" : "⬇️  儲存到手機 / Save to Phone"}
          </button>

          <p className="text-xs text-center px-3" style={{ color: "#7a6e5f", fontFamily: "var(--font-body)", lineHeight: 1.5 }}>
            按下後會開啟手機分享或下載面板，請選擇「儲存圖片」或相簿。
            <br />
            This opens your phone's share or download sheet so you can save the photo to your gallery.
          </p>

          {saveError && (
            <p className="text-xs text-center px-3" style={{ color: "#c0392b", fontFamily: "var(--font-body)", lineHeight: 1.5 }}>
              {saveError}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ─── Check-in Screen ──────────────────────────────────────────────────────────

function CheckInScreen({ onStart, authIssue }: { onStart: (name: string, session: string, checkInNumber: number) => void; authIssue: string | null }) {
  const [name, setName] = useState("")
  const [session, setSession] = useState("")
  const [checkInNumber, setCheckInNumber] = useState("")
  const [touched, setTouched] = useState(false)

  const parsedNumber = Number.parseInt(checkInNumber, 10)
  const validCheckInNumber = Number.isInteger(parsedNumber) && parsedNumber > 0
  const valid = name.trim().length > 1 && session !== "" && validCheckInNumber

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#f5f0e8" }}>
      <div
        className="relative overflow-hidden flex-shrink-0"
        style={{ height: 260, backgroundColor: "#1e3a2f" }}
      >
        <img
          src="https://images.unsplash.com/photo-1521587760476-6c12a4b040da?w=800&h=400&fit=crop&auto=format"
          alt="Library interior"
          className="w-full h-full object-cover opacity-40"
        />
        <div className="absolute inset-0 flex flex-col justify-end p-6 pb-8">
          <div
            className="text-xs font-semibold tracking-widest uppercase mb-2"
            style={{ color: "#c4793a", fontFamily: "var(--font-body)" }}
          >
            歡迎來到 / Welcome to
          </div>
          <h1
            className="text-3xl font-bold leading-tight"
            style={{ fontFamily: "var(--font-display)", color: "#faf7f2" }}
          >
            圖書館迎新探索
            <br />
            Library Orientation Tour
          </h1>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ backgroundColor: "#c4793a", opacity: 0.6 }} />
      </div>

      <div className="flex-1 px-6 pt-8 pb-6 flex flex-col gap-6">
        <div className="flex flex-col gap-1.5" style={{ color: "#7a6e5f", fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.6 }}>
          <p>
            請填寫姓名、時段與報到序號。系統會依序號自動分到 A/B/C/D 組，讓各站人流平均。
          </p>
          <p>
            Enter your name, session, and check-in number. The app assigns Group A/B/C/D by order to balance crowd flow.
          </p>
        </div>

        {authIssue && (
          <div className="px-4 py-3" style={{ backgroundColor: "#fff3f0", borderRadius: 10, border: "1px solid #e08a7d" }}>
            <p className="text-xs" style={{ color: "#8b3024", fontFamily: "var(--font-body)", lineHeight: 1.5 }}>
              無法初始化上傳身份：{authIssue}
              <br />
              Upload identity initialization failed: {authIssue}
            </p>
          </div>
        )}

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: "#1e3a2f", fontFamily: "var(--font-body)" }}
            >
              姓名 / Your Name
            </label>
            <input
              type="text"
              placeholder="例如：陳小明 / e.g. Chris Chan"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none"
              style={{
                fontFamily: "var(--font-body)",
                backgroundColor: "#faf7f2",
                border: `1.5px solid ${touched && name.trim().length < 2 ? "#c0392b" : "#c4793a40"}`,
                borderRadius: 8,
                color: "#1e3a2f",
              }}
            />
            {touched && name.trim().length < 2 && (
              <span className="text-xs" style={{ color: "#c0392b" }}>請輸入姓名 / Please enter your name.</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: "#1e3a2f", fontFamily: "var(--font-body)" }}
            >
              迎新時段 / Orientation Session
            </label>
            <select
              value={session}
              onChange={(e) => setSession(e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none appearance-none"
              style={{
                fontFamily: "var(--font-body)",
                backgroundColor: "#faf7f2",
                border: `1.5px solid ${touched && session === "" ? "#c0392b" : "#c4793a40"}`,
                borderRadius: 8,
                color: session === "" ? "#7a6e5f" : "#1e3a2f",
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231e3a2f' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 14px center",
                backgroundSize: 18,
              }}
            >
              <option value="">請選擇時段 / Select a session...</option>
              {SESSIONS.map((s) => (
                <option key={s.id} value={s.id}>{s.zh} / {s.en}</option>
              ))}
            </select>
            {touched && session === "" && (
              <span className="text-xs" style={{ color: "#c0392b" }}>請選擇時段 / Please select a session.</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-semibold tracking-widest uppercase"
              style={{ color: "#1e3a2f", fontFamily: "var(--font-body)" }}
            >
              報到序號 / Check-in Number
            </label>
            <input
              type="number"
              min={1}
              placeholder="例如：37 / e.g. 37"
              value={checkInNumber}
              onChange={(e) => setCheckInNumber(e.target.value)}
              className="w-full px-4 py-3 text-sm outline-none"
              style={{
                fontFamily: "var(--font-body)",
                backgroundColor: "#faf7f2",
                border: `1.5px solid ${touched && !validCheckInNumber ? "#c0392b" : "#c4793a40"}`,
                borderRadius: 8,
                color: "#1e3a2f",
              }}
            />
            {touched && !validCheckInNumber && (
              <span className="text-xs" style={{ color: "#c0392b" }}>請輸入大於 0 的整數 / Enter an integer greater than 0.</span>
            )}
          </div>
        </div>

        <div className="mt-auto pt-4">
          <button
            onClick={() => {
              setTouched(true)
              if (valid) {
                onStart(name.trim(), session, parsedNumber)
              }
            }}
            className="w-full py-4 text-sm font-semibold tracking-wide transition-all active:scale-95"
            style={{
              fontFamily: "var(--font-body)",
              backgroundColor: "#1e3a2f",
              color: "#faf7f2",
              borderRadius: 10,
              letterSpacing: "0.05em",
            }}
          >
            開始探索 / Begin Tour →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tour Stop Screen ─────────────────────────────────────────────────────────

function TourScreen({
  name,
  groupId,
  stop,
  stopIndex,
  totalStops,
  onReadyToCheckIn,
  onPrev,
}: {
  name: string
  groupId: GroupId
  stop: TourStop
  stopIndex: number
  totalStops: number
  onReadyToCheckIn: () => void
  onPrev: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#f5f0e8" }}>
      <div className="flex items-center justify-between px-5 pt-4">
        <button
          onClick={onPrev}
          className="w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-90"
          style={{ backgroundColor: "#1e3a2f15" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e3a2f" strokeWidth="2.5">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <div className="text-center">
          <span
            className="text-xs font-semibold tracking-widest uppercase"
            style={{ color: "#7a6e5f", fontFamily: "var(--font-body)" }}
          >
            第 {stopIndex + 1} 站（共 {totalStops} 站） / Stop {stopIndex + 1} of {totalStops}
          </span>
          <p className="text-xs" style={{ color: "#2d5242", fontFamily: "var(--font-body)" }}>
            你是 {groupId} 組 / You are in Group {groupId}
          </p>
        </div>
        <div className="w-9" />
      </div>

      <ProgressBar current={stopIndex} total={totalStops} />

      <div
        className="mx-5 overflow-hidden relative flex-shrink-0"
        style={{ borderRadius: 14, height: 210, backgroundColor: "#ede6d6" }}
      >
        <img src={stop.imageUrl} alt={stop.imageAlt} className="w-full h-full object-cover" />
        <div
          className="absolute top-3 left-3 w-8 h-8 flex items-center justify-center"
          style={{ backgroundColor: "#1e3a2f", borderRadius: 6 }}
        >
          <span className="text-sm font-bold" style={{ color: "#c4793a", fontFamily: "var(--font-display)" }}>
            {stopIndex + 1}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pt-5 pb-4">
        <div
          className="text-xs font-semibold tracking-widest uppercase mb-1"
          style={{ color: "#c4793a", fontFamily: "var(--font-body)" }}
        >
          {stop.locationZh}
          <br />
          {stop.locationEn}
        </div>
        <h2
          className="text-2xl font-bold leading-tight mb-4"
          style={{ fontFamily: "var(--font-display)", color: "#1e3a2f" }}
        >
          {stop.nameZh}
          <br />
          <span className="text-lg" style={{ color: "#2d5242" }}>{stop.nameEn}</span>
        </h2>
        <div className="text-sm leading-relaxed mb-4 flex flex-col gap-2" style={{ color: "#4a4035", fontFamily: "var(--font-body)" }}>
          <p>{stop.descriptionZh}</p>
          <p>{stop.descriptionEn}</p>
        </div>
        <div
          className="flex gap-3 px-4 py-3"
          style={{ backgroundColor: "#1e3a2f12", borderRadius: 10, borderLeft: "3px solid #c4793a" }}
        >
          <span className="text-lg flex-shrink-0 mt-0.5">💡</span>
          <div className="text-xs leading-relaxed flex flex-col gap-1" style={{ color: "#2d5242", fontFamily: "var(--font-body)" }}>
            <p><strong>提示：</strong>{stop.tipZh}</p>
            <p><strong>Tip:</strong> {stop.tipEn}</p>
          </div>
        </div>
        {stopIndex === 0 && (
          <div className="text-xs mt-4 text-center flex flex-col gap-1" style={{ color: "#7a6e5f", fontFamily: "var(--font-body)" }}>
            <p>歡迎你，{firstName(name)}！每一站都需要完成一次拍照打卡。</p>
            <p>Welcome, {firstName(name)}! A photo check-in is required at every stop.</p>
          </div>
        )}
      </div>

      <div className="px-5 pb-8 pt-2 flex-shrink-0">
        <button
          onClick={onReadyToCheckIn}
          className="w-full py-4 text-sm font-semibold tracking-wide transition-all active:scale-95 flex items-center justify-center gap-2"
          style={{
            fontFamily: "var(--font-body)",
            backgroundColor: "#c4793a",
            color: "#faf7f2",
            borderRadius: 10,
            letterSpacing: "0.05em",
          }}
        >
          <span>📸</span>
          <span>在此打卡 / Check In Here</span>
        </button>
      </div>
    </div>
  )
}

// ─── Per-stop Photo Check-in ──────────────────────────────────────────────────

function StopPhotoScreen({
  name,
  groupId,
  stop,
  stopIndex,
  totalStops,
  nextStop,
  onDone,
  onBack,
}: {
  name: string
  groupId: GroupId
  stop: TourStop
  stopIndex: number
  totalStops: number
  nextStop: TourStop | null
  onDone: (photo: string) => void
  onBack: () => void
}) {
  const [photo, setPhoto] = useState<string | null>(null)
  const isLast = stopIndex === totalStops - 1

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#f5f0e8" }}>
      <div className="flex items-center justify-between px-5 pt-4">
        <button
          onClick={onBack}
          className="w-9 h-9 flex items-center justify-center rounded-full transition-all active:scale-90"
          style={{ backgroundColor: "#1e3a2f15" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e3a2f" strokeWidth="2.5">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span
          className="text-xs font-semibold tracking-widest uppercase"
          style={{ color: "#7a6e5f", fontFamily: "var(--font-body)" }}
        >
          {groupId} 組 · 拍照打卡第 {stopIndex + 1} 站 / Group {groupId} Check-in · Stop {stopIndex + 1}
        </span>
        <div className="w-9" />
      </div>

      <ProgressBar current={stopIndex + 1} total={totalStops} />

      <div className="flex-1 px-5 pt-4 pb-8 flex flex-col gap-5 overflow-y-auto">
        <div
          className="flex items-center gap-3 px-4 py-3"
          style={{ backgroundColor: "#1e3a2f", borderRadius: 12 }}
        >
          <div
            className="w-9 h-9 flex-shrink-0 flex items-center justify-center"
            style={{ backgroundColor: "#c4793a20", borderRadius: 8 }}
          >
            <span className="text-base font-bold" style={{ color: "#c4793a", fontFamily: "var(--font-display)" }}>
              {stopIndex + 1}
            </span>
          </div>
          <div>
            <p className="text-xs" style={{ color: "#a8c0b0", fontFamily: "var(--font-body)" }}>{stop.locationZh}</p>
            <p className="text-xs" style={{ color: "#a8c0b0", fontFamily: "var(--font-body)" }}>{stop.locationEn}</p>
            <p className="text-sm font-semibold leading-tight" style={{ color: "#faf7f2", fontFamily: "var(--font-display)" }}>
              {stop.nameZh} / {stop.nameEn}
            </p>
          </div>
        </div>

        <div className="text-center">
          <p
            className="text-lg font-bold mb-1"
            style={{ fontFamily: "var(--font-display)", color: "#1e3a2f" }}
          >
            你到達了，{firstName(name)}！ / You made it, {firstName(name)}!
          </p>
          <div className="text-sm flex flex-col gap-1" style={{ color: "#7a6e5f", fontFamily: "var(--font-body)" }}>
            <p>請在這一站拍照或自拍完成打卡。</p>
            <p>Take a photo or selfie here to stamp your visit.</p>
          </div>
        </div>

        <PhotoCapture
          label={`點一下拍攝 ${stop.nameZh}（${stop.nameEn}）的照片。\nTap to capture your photo at ${stop.nameEn}.`}
          photo={photo}
          onCapture={setPhoto}
        />

        <div
          className="px-4 py-3"
          style={{ backgroundColor: "#f5f0e8", borderRadius: 10, border: "1px solid #c4793a45" }}
        >
          <p className="text-xs" style={{ color: "#4a4035", fontFamily: "var(--font-body)", lineHeight: 1.6 }}>
            這一站照片只會留在你的手機與目前瀏覽器，不會上傳到伺服器。<br />
            This stop photo stays on your device and browser only. It will not be uploaded.
          </p>
        </div>

        {photo && (
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ backgroundColor: "#1e3a2f0d", borderRadius: 10, border: "1px solid #c4793a30" }}
          >
            <span style={{ fontSize: 18 }}>✅</span>
            <div className="text-xs flex flex-col gap-1" style={{ color: "#2d5242", fontFamily: "var(--font-body)" }}>
              <p>拍得很好！這一站「{stop.nameZh}」已完成打卡。</p>
              <p>Great shot! Your check-in for {stop.nameEn} is ready.</p>
            </div>
          </div>
        )}

        <button
          onClick={() => photo && onDone(photo)}
          className="w-full py-4 text-sm font-semibold tracking-wide transition-all active:scale-95"
          style={{
            fontFamily: "var(--font-body)",
            backgroundColor: photo ? "#1e3a2f" : "#1e3a2f40",
            color: photo ? "#faf7f2" : "#faf7f260",
            borderRadius: 10,
            letterSpacing: "0.05em",
            cursor: photo ? "pointer" : "not-allowed",
          }}
        >
          {photo
            ? isLast
              ? "前往最後上傳步驟 / Go to Final Upload →"
              : `前往下一站 / Next Stop: ${nextStop?.nameZh ?? "..."} →`
            : "先拍照才能繼續 / Take a photo to continue"}
        </button>

        {!photo && (
          <div className="text-center text-xs flex flex-col gap-1" style={{ color: "#c0392b", fontFamily: "var(--font-body)" }}>
            <p>必須完成拍照才可前往下一站。</p>
            <p>A photo is required to proceed.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Favourite Photo Screen ───────────────────────────────────────────────────

function FavouritePhotoScreen({
  name,
  groupId,
  sessionText,
  authReady,
  isUploading,
  uploadError,
  onDone,
}: {
  name: string
  groupId: GroupId
  sessionText: string
  authReady: boolean
  isUploading: boolean
  uploadError: string | null
  onDone: (photo: string) => Promise<void>
}) {
  const [photo, setPhoto] = useState<string | null>(null)

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#1e3a2f" }}>
      <div className="px-6 pt-10 pb-6 flex flex-col items-center text-center">
        <div
          className="w-16 h-16 flex items-center justify-center mb-4"
          style={{ border: "2px solid #c4793a", borderRadius: "50%" }}
        >
          <span style={{ fontSize: 30 }}>✨</span>
        </div>
        <div
          className="text-xs font-semibold tracking-widest uppercase mb-2"
          style={{ color: "#c4793a", fontFamily: "var(--font-body)" }}
        >
          最後挑戰 / Final Challenge
        </div>
        <h2
          className="text-2xl font-bold leading-snug mb-3"
          style={{ fontFamily: "var(--font-display)", color: "#faf7f2" }}
        >
          你最想記住哪一角？
          <br />
          What Caught Your Eye?
        </h2>
        <div
          className="text-sm leading-relaxed"
          style={{ color: "#a8c0b0", fontFamily: "var(--font-body)", maxWidth: 310 }}
        >
          <p>{name}（{groupId} 組）請拍下你最感興趣的一處，這張照片會上傳到活動記錄系統。</p>
          <p>{name} in Group {groupId}, capture your most intriguing spot. This photo will be uploaded to the event record system.</p>
          <p className="mt-2">{sessionText}</p>
        </div>
      </div>

      <div
        className="mx-5 flex-1 flex flex-col gap-5 px-5 py-6 mb-6"
        style={{ backgroundColor: "#f5f0e8", borderRadius: 20 }}
      >
        <div
          className="px-4 py-3 flex gap-3"
          style={{ backgroundColor: "#1e3a2f12", borderRadius: 10, borderLeft: "3px solid #c4793a" }}
        >
          <span className="text-lg mt-0.5">☁️</span>
          <div className="text-xs leading-relaxed flex flex-col gap-1" style={{ color: "#4a4035", fontFamily: "var(--font-body)" }}>
            <p>這張「最感興趣照片」會上傳並記錄姓名、時段、組別。</p>
            <p>This favourite photo will be uploaded with your name, session, and group.</p>
          </div>
        </div>

        <PhotoCapture
          label="點一下拍攝你最感興趣的地方。\nTap to capture the spot that intrigued you most."
          photo={photo}
          onCapture={setPhoto}
        />

        {uploadError && (
          <div
            className="px-4 py-3"
            style={{ backgroundColor: "#fff3f0", borderRadius: 10, border: "1px solid #e08a7d" }}
          >
            <p className="text-xs" style={{ color: "#8b3024", fontFamily: "var(--font-body)", lineHeight: 1.6 }}>
              上傳失敗：{uploadError}
              <br />
              Upload failed: {uploadError}
            </p>
          </div>
        )}

        {!authReady && (
          <div
            className="px-4 py-3"
            style={{ backgroundColor: "#fff6e8", borderRadius: 10, border: "1px solid #d8a55a" }}
          >
            <p className="text-xs" style={{ color: "#6a4a1c", fontFamily: "var(--font-body)", lineHeight: 1.6 }}>
              正在連線到上傳系統，請稍候。
              <br />
              Connecting to upload service, please wait.
            </p>
          </div>
        )}

        <button
          onClick={() => photo && onDone(photo)}
          disabled={!photo || !authReady || isUploading}
          className="w-full py-4 text-sm font-semibold tracking-wide transition-all active:scale-95"
          style={{
            fontFamily: "var(--font-body)",
            backgroundColor: photo && authReady && !isUploading ? "#1e3a2f" : "#1e3a2f40",
            color: photo && authReady && !isUploading ? "#faf7f2" : "#faf7f260",
            borderRadius: 10,
            letterSpacing: "0.05em",
            cursor: photo && authReady && !isUploading ? "pointer" : "not-allowed",
          }}
        >
          {isUploading ? "上傳中，請稍候... / Uploading..." : "上傳並完成 / Upload & Finish →"}
        </button>

        {!photo && (
          <div className="text-center text-xs flex flex-col gap-1" style={{ color: "#c0392b", fontFamily: "var(--font-body)" }}>
            <p>需要這張照片才能完成整個活動。</p>
            <p>This photo is required to complete the tour.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Complete Screen ──────────────────────────────────────────────────────────

function CompleteScreen({
  name,
  groupId,
  session,
  stopPhotos,
  favouritePhoto,
  uploadedPath,
}: {
  name: string
  groupId: GroupId
  session: string
  stopPhotos: string[]
  favouritePhoto: string
  uploadedPath: string
}) {
  const today = new Date()
  const dateStrZh = today.toLocaleDateString("zh-HK", { year: "numeric", month: "long", day: "numeric" })
  const dateStrEn = today.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
  const selectedSession = SESSIONS.find((item) => item.id === session)
  const displaySessionZh = selectedSession?.zh ?? "未選擇時段"
  const displaySessionEn = selectedSession?.en ?? "Session not selected"

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#1e3a2f" }}>
      <div className="flex-shrink-0 pt-10 px-5 text-center">
        <div
          className="mx-auto mb-4 w-20 h-20 flex items-center justify-center"
          style={{ border: "2px solid #c4793a", borderRadius: "50%", position: "relative" }}
        >
          <div style={{ position: "absolute", inset: 5, border: "1px solid #c4793a60", borderRadius: "50%" }} />
          <span style={{ fontSize: 36 }}>🏛️</span>
        </div>
        <div
          className="text-xs font-semibold tracking-widest uppercase mb-2"
          style={{ color: "#c4793a", fontFamily: "var(--font-body)" }}
        >
          完成探索 / Tour Complete
        </div>
        <h2
          className="text-3xl font-bold leading-tight mb-2"
          style={{ fontFamily: "var(--font-display)", color: "#faf7f2" }}
        >
          恭喜你，{name}！
          <br />Congratulations, {name}!
        </h2>
        <div className="text-sm flex flex-col gap-1" style={{ color: "#a8c0b0", fontFamily: "var(--font-body)" }}>
          <p>你屬於 {groupId} 組，並完成全部 {TOUR_STOPS.length} 站。</p>
          <p>You are in Group {groupId} and completed all {TOUR_STOPS.length} stops.</p>
        </div>
      </div>

      <div className="mx-5 mt-6 overflow-hidden relative" style={{ borderRadius: 16, height: 200 }}>
        <img src={favouritePhoto} alt="Your most intriguing spot" className="w-full h-full object-cover" />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, #1e3a2fdd 30%, transparent)" }}
        />
        <div className="absolute bottom-3 left-4 right-4">
          <p className="text-xs font-semibold tracking-widest uppercase mb-0.5" style={{ color: "#c4793a", fontFamily: "var(--font-body)" }}>
            你最有感覺的一站 / Your Most Intriguing Spot
          </p>
          <p className="text-sm font-semibold" style={{ color: "#faf7f2", fontFamily: "var(--font-display)" }}>
            {name} 的圖書館發現 / {name}&apos;s Library Discovery
          </p>
        </div>
      </div>

      <div className="px-5 mt-4">
        <p className="text-xs font-semibold tracking-widest uppercase mb-2" style={{ color: "#a8c0b0", fontFamily: "var(--font-body)" }}>
          打卡記錄 / Check-in Stamps
        </p>
        <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
          {stopPhotos.map((src, i) => (
            <div
              key={i}
              className="flex-shrink-0 overflow-hidden"
              style={{ width: 64, height: 64, borderRadius: 10, border: "2px solid #c4793a50" }}
            >
              <img src={src} alt={`第 ${i + 1} 站 / Stop ${i + 1}`} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      </div>

      <div
        className="mx-5 mt-5 mb-8"
        style={{ backgroundColor: "#faf7f2", borderRadius: 16, padding: "24px 20px" }}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px" style={{ backgroundColor: "#c4793a40" }} />
          <span className="text-xs tracking-widest uppercase" style={{ color: "#c4793a", fontFamily: "var(--font-body)" }}>完成證書 / Certificate</span>
          <div className="flex-1 h-px" style={{ backgroundColor: "#c4793a40" }} />
        </div>

        <div
          className="px-4 py-3 mb-3"
          style={{ backgroundColor: "#1e3a2f12", borderRadius: 10, borderLeft: "3px solid #c4793a" }}
        >
          <p className="text-center text-sm leading-relaxed" style={{ color: "#1e3a2f", fontFamily: "var(--font-body)", fontWeight: 700 }}>
            最感興趣照片已成功上傳。<br />
            Favourite photo uploaded successfully.
          </p>
          <p className="text-center text-xs mt-2" style={{ color: "#4a4035", fontFamily: "var(--font-body)" }}>
            Path: {uploadedPath}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: "組別 / Group", value: groupId },
            { label: "站數 / Stops", value: `${TOUR_STOPS.length}` },
            { label: "日期 / Date", value: `${today.getDate()}/${today.getMonth() + 1}` },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col items-center py-2 px-1" style={{ backgroundColor: "#f5f0e8", borderRadius: 8 }}>
              <span className="text-lg font-bold" style={{ fontFamily: "var(--font-display)", color: "#1e3a2f" }}>{value}</span>
              <span className="text-xs" style={{ color: "#7a6e5f", fontFamily: "var(--font-body)" }}>{label}</span>
            </div>
          ))}
        </div>

        <div
          className="px-4 py-3 mb-3"
          style={{ backgroundColor: "#1e3a2f12", borderRadius: 10, borderLeft: "3px solid #c4793a" }}
        >
          <p className="text-center text-sm leading-relaxed" style={{ color: "#1e3a2f", fontFamily: "var(--font-body)", fontWeight: 700 }}>
            恭喜完成！請回到你的座位等待下一步指示。<br />
            Great work! Please return to your seat and wait for further instructions.
          </p>
        </div>

        <p className="text-center text-xs mt-3" style={{ color: "#7a6e5f", fontFamily: "var(--font-body)" }}>
          {dateStrZh} / {dateStrEn}
          <br />
          {displaySessionZh} / {displaySessionEn}
        </p>
      </div>
    </div>
  )
}

// ─── Gallery (staff) ──────────────────────────────────────────────────────────

function GalleryPage() {
  const [unlocked, setUnlocked] = useState(false)
  const [passcode, setPasscode] = useState("")
  const [passError, setPassError] = useState(false)

  const [sessionId, setSessionId] = useState("")
  const [items, setItems] = useState<GallerySubmission[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = async (targetSession: string) => {
    if (!targetSession) {
      setItems([])
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const result = await fetchSessionSubmissions(targetSession)
      setItems(result)
    } catch (error) {
      setLoadError(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const handleSessionChange = (value: string) => {
    setSessionId(value)
    void load(value)
  }

  const handleDelete = async (item: GallerySubmission) => {
    const label = item.studentName ? `「${item.studentName}」` : "這張"
    if (!window.confirm(`確定要刪除${label}的照片嗎？此動作無法復原。`)) {
      return
    }
    setDeletingId(item.id)
    try {
      await deleteSubmission(item)
      setItems((prev) => prev.filter((entry) => entry.id !== item.id))
    } catch (error) {
      window.alert(`刪除失敗：${getErrorMessage(error)}`)
    } finally {
      setDeletingId(null)
    }
  }

  const handleUnlock = () => {
    if (passcode === GALLERY_PASSCODE) {
      setUnlocked(true)
      setPassError(false)
    } else {
      setPassError(true)
    }
  }

  if (!unlocked) {
    return (
      <div className="max-w-sm mx-auto min-h-screen flex flex-col justify-center px-6" style={{ fontFamily: "var(--font-body)" }}>
        <h1 className="text-2xl font-bold mb-2" style={{ color: "#1e3a2f", fontFamily: "var(--font-display)" }}>
          相簿管理 / Gallery
        </h1>
        <p className="text-sm mb-6" style={{ color: "#7a6e5f" }}>
          工作人員專用，請輸入密碼進入。
        </p>
        <input
          type="password"
          inputMode="numeric"
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value)
            setPassError(false)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleUnlock()
          }}
          placeholder="密碼 / Passcode"
          className="w-full px-4 py-3 mb-3"
          style={{
            borderRadius: 10,
            border: `1.5px solid ${passError ? "#c0392b" : "#c4793a40"}`,
            backgroundColor: "#faf7f2",
            color: "#1e3a2f",
            outline: "none",
          }}
        />
        {passError && (
          <p className="text-sm mb-3" style={{ color: "#c0392b" }}>
            密碼錯誤 / Wrong passcode
          </p>
        )}
        <button
          onClick={handleUnlock}
          className="w-full py-3.5 text-sm font-semibold transition-all active:scale-95"
          style={{
            fontFamily: "var(--font-body)",
            backgroundColor: "#c4793a",
            color: "#faf7f2",
            borderRadius: 10,
            letterSpacing: "0.04em",
          }}
        >
          進入 / Enter
        </button>
      </div>
    )
  }

  const sessionInfo = SESSIONS.find((s) => s.id === sessionId)

  return (
    <div className="max-w-4xl mx-auto min-h-screen px-4 py-6" style={{ fontFamily: "var(--font-body)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-bold" style={{ color: "#1e3a2f", fontFamily: "var(--font-display)" }}>
          相簿管理 / Gallery
        </h1>
        <div className="flex items-center gap-2">
          <select
            value={sessionId}
            onChange={(e) => handleSessionChange(e.target.value)}
            className="px-3 py-2.5 text-sm"
            style={{
              borderRadius: 10,
              border: "1.5px solid #c4793a40",
              backgroundColor: "#faf7f2",
              color: sessionId === "" ? "#7a6e5f" : "#1e3a2f",
              outline: "none",
            }}
          >
            <option value="">選擇場次 / Select session…</option>
            {SESSIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.zh} / {s.en}
              </option>
            ))}
          </select>
          <button
            onClick={() => void load(sessionId)}
            disabled={!sessionId || loading}
            className="px-4 py-2.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
            style={{
              fontFamily: "var(--font-body)",
              backgroundColor: "#2d5242",
              color: "#faf7f2",
              borderRadius: 10,
            }}
          >
            {loading ? "載入中…" : "重新整理 / Refresh"}
          </button>
        </div>
      </div>

      {sessionId !== "" && !loading && (
        <p className="text-sm mb-4" style={{ color: "#7a6e5f" }}>
          {sessionInfo ? `${sessionInfo.zh} / ${sessionInfo.en}` : ""} · 共 {items.length} 張
        </p>
      )}

      {loadError && (
        <p className="text-sm mb-4" style={{ color: "#c0392b" }}>
          載入失敗：{loadError}
        </p>
      )}

      {sessionId === "" && (
        <p className="text-sm" style={{ color: "#7a6e5f" }}>
          請先選擇場次以顯示照片。
        </p>
      )}

      {sessionId !== "" && !loading && items.length === 0 && !loadError && (
        <p className="text-sm" style={{ color: "#7a6e5f" }}>
          此場次目前沒有照片。
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {items.map((item) => (
          <div
            key={item.id}
            className="relative overflow-hidden"
            style={{ borderRadius: 12, border: "1px solid #c4793a30", backgroundColor: "#1e3a2f08" }}
          >
            <img
              src={item.photoUrl}
              alt={item.studentName || "submission"}
              className="w-full object-cover"
              style={{ aspectRatio: "3 / 4" }}
              loading="lazy"
            />
            <div className="px-2 py-1.5 flex items-center justify-between gap-2">
              <span className="text-xs truncate" style={{ color: "#1e3a2f" }}>
                {item.studentName || "—"}
                {item.groupId ? ` · ${item.groupId}` : ""}
              </span>
              <button
                onClick={() => void handleDelete(item)}
                disabled={deletingId === item.id}
                className="text-xs font-semibold px-2 py-1 transition-all active:scale-95 disabled:opacity-50"
                style={{
                  backgroundColor: "#c0392b",
                  color: "#faf7f2",
                  borderRadius: 6,
                  flexShrink: 0,
                }}
              >
                {deletingId === item.id ? "刪除中…" : "刪除"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const isGallery =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("gallery")

  if (isGallery) {
    return <GalleryPage />
  }

  return <MainApp />
}

function MainApp() {
  const [screen, setScreen] = useState<Screen>("checkin")
  const [visitorName, setVisitorName] = useState("")
  const [visitorSession, setVisitorSession] = useState("")
  const [visitorGroup, setVisitorGroup] = useState<GroupId>("A")
  const [routeStops, setRouteStops] = useState<TourStop[]>(getRouteStops("A"))
  const [stopIndex, setStopIndex] = useState(0)
  const [subPhase, setSubPhase] = useState<"info" | "photo">("info")
  const [stopPhotos, setStopPhotos] = useState<string[]>([])
  const [favouritePhoto, setFavouritePhoto] = useState("")
  const [uploadedPath, setUploadedPath] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [authIssue, setAuthIssue] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const initAuth = async () => {
      try {
        await ensureAnonymousAuth()
        if (active) {
          setAuthReady(true)
          setAuthIssue(null)
        }
      } catch (error) {
        if (active) {
          setAuthReady(false)
          setAuthIssue(getErrorMessage(error))
        }
      }
    }

    void initAuth()

    return () => {
      active = false
    }
  }, [])

  const currentStop = routeStops[stopIndex] ?? null
  const nextStop = stopIndex < routeStops.length - 1 ? routeStops[stopIndex + 1] : null
  const sessionInfo = SESSIONS.find((s) => s.id === visitorSession)
  const sessionText = sessionInfo ? `${sessionInfo.zh} / ${sessionInfo.en}` : ""

  const handleStart = (name: string, session: string, checkInNumber: number) => {
    const groupId = getGroupByCheckInNumber(checkInNumber)
    const route = getRouteStops(groupId)

    setVisitorName(name)
    setVisitorSession(session)
    setVisitorGroup(groupId)
    setRouteStops(route)
    setStopIndex(0)
    setSubPhase("info")
    setStopPhotos([])
    setFavouritePhoto("")
    setUploadedPath("")
    setUploadError(null)
    setScreen("tour")
  }

  const handlePrev = () => {
    if (subPhase === "photo") {
      setSubPhase("info")
      return
    }

    if (stopIndex > 0) {
      setStopIndex((i) => i - 1)
      setSubPhase("photo")
      return
    }

    setScreen("checkin")
  }

  const handleStopPhotoDone = (photo: string) => {
    const updated = [...stopPhotos.slice(0, stopIndex), photo]
    setStopPhotos(updated)

    if (stopIndex < routeStops.length - 1) {
      setStopIndex((i) => i + 1)
      setSubPhase("info")
      return
    }

    setScreen("favourite-photo")
  }

  const handleFavouriteDone = async (photo: string) => {
    setUploadError(null)
    setIsUploading(true)

    try {
      const uploaded = await uploadFavouriteSubmission({
        studentName: visitorName,
        sessionId: visitorSession,
        groupId: visitorGroup,
        routeStopIds: routeStops.map((stop) => stop.id),
        photoDataUrl: photo,
      })
      setFavouritePhoto(photo)
      setUploadedPath(uploaded.photoPath)
      setScreen("complete")
    } catch (error) {
      setUploadError(getErrorMessage(error))
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="max-w-sm mx-auto min-h-screen" style={{ fontFamily: "var(--font-body)" }}>
      {screen === "checkin" && (
        <CheckInScreen onStart={handleStart} authIssue={authIssue} />
      )}

      {screen === "tour" && subPhase === "info" && currentStop && (
        <TourScreen
          name={visitorName}
          groupId={visitorGroup}
          stop={currentStop}
          stopIndex={stopIndex}
          totalStops={routeStops.length}
          onReadyToCheckIn={() => setSubPhase("photo")}
          onPrev={handlePrev}
        />
      )}

      {screen === "tour" && subPhase === "photo" && currentStop && (
        <StopPhotoScreen
          name={visitorName}
          groupId={visitorGroup}
          stop={currentStop}
          stopIndex={stopIndex}
          totalStops={routeStops.length}
          nextStop={nextStop}
          onDone={handleStopPhotoDone}
          onBack={() => setSubPhase("info")}
        />
      )}

      {screen === "favourite-photo" && (
        <FavouritePhotoScreen
          name={visitorName}
          groupId={visitorGroup}
          sessionText={sessionText}
          authReady={authReady}
          isUploading={isUploading}
          uploadError={uploadError}
          onDone={handleFavouriteDone}
        />
      )}

      {screen === "complete" && (
        <CompleteScreen
          name={visitorName}
          groupId={visitorGroup}
          session={visitorSession}
          stopPhotos={stopPhotos}
          favouritePhoto={favouritePhoto || stopPhotos[stopPhotos.length - 1]}
          uploadedPath={uploadedPath}
        />
      )}
    </div>
  )
}
