import { initializeApp } from "firebase/app"
import { getAuth, signInAnonymously, type User } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing Firebase env: ${name}`)
  }
  return value
}

const firebaseConfig = {
  apiKey: requireEnv("VITE_FIREBASE_API_KEY", import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: requireEnv("VITE_FIREBASE_AUTH_DOMAIN", import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: requireEnv("VITE_FIREBASE_PROJECT_ID", import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: requireEnv("VITE_FIREBASE_STORAGE_BUCKET", import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: requireEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: requireEnv("VITE_FIREBASE_APP_ID", import.meta.env.VITE_FIREBASE_APP_ID),
}

const uploadBucketEnv = import.meta.env.VITE_FIREBASE_UPLOAD_BUCKET?.trim()
const uploadBucket = uploadBucketEnv
  ? uploadBucketEnv.startsWith("gs://")
    ? uploadBucketEnv
    : `gs://${uploadBucketEnv}`
  : null

const firestoreDatabaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID?.trim()

export const firebaseApp = initializeApp(firebaseConfig)
export const firebaseAuth = getAuth(firebaseApp)
export const firestoreDb = firestoreDatabaseId
  ? getFirestore(firebaseApp, firestoreDatabaseId)
  : getFirestore(firebaseApp)
export const defaultStorage = getStorage(firebaseApp)
export const uploadStorage = uploadBucket ? getStorage(firebaseApp, uploadBucket) : defaultStorage

export async function ensureAnonymousAuth(): Promise<User> {
  if (firebaseAuth.currentUser) {
    return firebaseAuth.currentUser
  }
  const credential = await signInAnonymously(firebaseAuth)
  return credential.user
}
