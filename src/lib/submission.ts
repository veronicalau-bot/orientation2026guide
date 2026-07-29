import { doc, serverTimestamp, setDoc } from "firebase/firestore"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { ensureAnonymousAuth, firestoreDb, uploadStorage } from "./firebase"

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const TARGET_UPLOAD_BYTES = 1_500_000
const MAX_DIMENSION = 1800

interface UploadPayload {
  studentName: string
  sessionId: string
  groupId: "A" | "B" | "C" | "D"
  routeStopIds: number[]
  photoDataUrl: string
}

interface UploadResult {
  downloadUrl: string
  photoPath: string
  sizeBytes: number
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Failed to decode image."))
    image.src = dataUrl
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to convert image blob."))
          return
        }
        resolve(blob)
      },
      "image/jpeg",
      quality,
    )
  })
}

async function compressImageDataUrl(dataUrl: string): Promise<Blob> {
  const image = await loadImage(dataUrl)
  const baseScale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height))
  let width = Math.max(1, Math.floor(image.width * baseScale))
  let height = Math.max(1, Math.floor(image.height * baseScale))

  const qualityCandidates = [0.86, 0.78, 0.7, 0.62, 0.55]

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext("2d")
    if (!context) {
      throw new Error("Canvas is not supported on this browser.")
    }

    context.drawImage(image, 0, 0, width, height)

    for (const quality of qualityCandidates) {
      const blob = await canvasToBlob(canvas, quality)
      if (blob.size <= TARGET_UPLOAD_BYTES) {
        return blob
      }
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return blob
      }
    }

    width = Math.max(900, Math.floor(width * 0.82))
    height = Math.max(900, Math.floor(height * 0.82))
  }

  const fallbackCanvas = document.createElement("canvas")
  fallbackCanvas.width = width
  fallbackCanvas.height = height
  const fallbackContext = fallbackCanvas.getContext("2d")
  if (!fallbackContext) {
    throw new Error("Canvas is not supported on this browser.")
  }
  fallbackContext.drawImage(image, 0, 0, width, height)
  return canvasToBlob(fallbackCanvas, 0.5)
}

export async function uploadFavouriteSubmission(payload: UploadPayload): Promise<UploadResult> {
  const { studentName, sessionId, groupId, routeStopIds, photoDataUrl } = payload
  const user = await ensureAnonymousAuth()
  const imageBlob = await compressImageDataUrl(photoDataUrl)

  if (imageBlob.size > MAX_UPLOAD_BYTES) {
    throw new Error("壓縮後照片仍超過 8MB，請重拍一張。")
  }

  const submissionRef = doc(firestoreDb, "submissions", crypto.randomUUID())
  const photoPath = `favourite-photos/${sessionId}/${submissionRef.id}.jpg`
  const imageRef = ref(uploadStorage, photoPath)

  await uploadBytes(imageRef, imageBlob, {
    contentType: "image/jpeg",
    customMetadata: {
      sessionId,
      groupId,
      uploaderUid: user.uid,
    },
  })

  const downloadUrl = await getDownloadURL(imageRef)

  await setDoc(submissionRef, {
    studentName,
    sessionId,
    groupId,
    routeId: groupId,
    routeStopIds,
    photoPath,
    photoUrl: downloadUrl,
    uploaderUid: user.uid,
    fileSizeBytes: imageBlob.size,
    createdAt: serverTimestamp(),
  })

  return {
    downloadUrl,
    photoPath,
    sizeBytes: imageBlob.size,
  }
}
