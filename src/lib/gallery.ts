import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from "firebase/firestore"
import { deleteObject, ref } from "firebase/storage"
import { ensureAnonymousAuth, firestoreDb, uploadStorage } from "./firebase"

export interface GallerySubmission {
  id: string
  studentName: string
  sessionId: string
  groupId: string
  checkInNumber: number | null
  photoPath: string
  photoUrl: string
  createdAtMs: number | null
}

export async function fetchSessionSubmissions(sessionId: string): Promise<GallerySubmission[]> {
  await ensureAnonymousAuth()

  const submissionsRef = collection(firestoreDb, "submissions")
  const submissionsQuery = query(submissionsRef, where("sessionId", "==", sessionId))

  const snapshot = await getDocs(submissionsQuery)

  const items = snapshot.docs.map((docSnap) => {
    const data = docSnap.data()
    const createdAt = data.createdAt
    const createdAtMs =
      createdAt && typeof createdAt.toMillis === "function" ? createdAt.toMillis() : null

    return {
      id: docSnap.id,
      studentName: typeof data.studentName === "string" ? data.studentName : "",
      sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
      groupId: typeof data.groupId === "string" ? data.groupId : "",
      checkInNumber: typeof data.checkInNumber === "number" ? data.checkInNumber : null,
      photoPath: typeof data.photoPath === "string" ? data.photoPath : "",
      photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : "",
      createdAtMs,
    }
  })

  items.sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
  return items
}

export async function deleteSubmission(submission: GallerySubmission): Promise<void> {
  await ensureAnonymousAuth()

  if (submission.photoPath) {
    try {
      await deleteObject(ref(uploadStorage, submission.photoPath))
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== "storage/object-not-found") {
        throw error
      }
    }
  }

  await deleteDoc(doc(firestoreDb, "submissions", submission.id))
}
