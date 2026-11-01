import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const AUDIO_BUCKET = "tcf-audio-files";
let storage: S3Client | undefined;

export function hasAudioStorage(): boolean {
  return Boolean(process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_REGION &&
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

/** Server-side only. Never fall back to unrelated AWS credentials on the host. */
export function getAudioStorage(): S3Client {
  if (!hasAudioStorage()) throw new Error("Neon object storage is not configured. Run neon deploy.");
  storage ??= new S3Client({
    endpoint: process.env.AWS_ENDPOINT_URL_S3!,
    region: process.env.AWS_REGION!,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
  return storage;
}

/** Only sign keys in the imported audio namespace, never arbitrary URLs. */
export function validAudioKey(value: string): boolean {
  return value.length <= 1024 && value.startsWith("tcf/") &&
    value.split("/").every((part) => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part));
}

export async function signedAudioUrl(key: string, method: "GET" | "HEAD"): Promise<string> {
  if (!validAudioKey(key)) throw new Error("Invalid audio object key.");
  const input = { Bucket: AUDIO_BUCKET, Key: key };
  const command = method === "HEAD" ? new HeadObjectCommand(input) : new GetObjectCommand(input);
  // The signature remains server-side; the browser uses /api/audio/<question-id>.
  return getSignedUrl(getAudioStorage(), command, { expiresIn: 60 });
}
