import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const activeConfig = {
  ...firebaseConfig,
  apiKey: (typeof process !== 'undefined' && process.env?.API_KEY) || firebaseConfig.apiKey,
};

const app = initializeApp(activeConfig);
export const db = getFirestore(app, activeConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Recursively cleans an object or array to ensure no `undefined` values exist,
 * which Firestore strictly forbids in `setDoc`, `updateDoc`, or `addDoc`.
 * Preserves special Firestore objects (FieldValue, Timestamp) and Dates.
 */
export function deepCleanForFirestore<T = any>(input: T): T {
  if (input === undefined) {
    return undefined as unknown as T;
  }
  if (input === null || typeof input !== 'object') {
    return input;
  }

  // Handle Arrays: recursively clean each element, filtering out any undefined
  if (Array.isArray(input)) {
    return input
      .map(item => deepCleanForFirestore(item))
      .filter(item => item !== undefined) as unknown as T;
  }

  // Preserve instances of non-plain objects (e.g. Timestamp, FieldValue, Date)
  if (input.constructor && input.constructor.name !== 'Object') {
    return input;
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(input as Record<string, any>)) {
    if (value !== undefined) {
      const cleanedValue = deepCleanForFirestore(value);
      if (cleanedValue !== undefined) {
        result[key] = cleanedValue;
      }
    }
  }

  return result as T;
}

