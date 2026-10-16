import { createVerify } from "node:crypto";

/** An Amazon SNS HTTP(S) message, as POSTed to our webhook. */
export type SnsMessage = {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
};

const CERT_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;
const certCache = new Map<string, string>();

/** Only AWS-hosted SNS endpoints may supply certificates or confirmation URLs (SSRF guard). */
export function isAwsSnsUrl(raw: string | undefined, path?: RegExp): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      CERT_HOST.test(url.hostname) &&
      (!path || path.test(url.pathname))
    );
  } catch {
    return false;
  }
}

/** The canonical string SNS signs (keys in this exact order, only those present). */
export function stringToSign(m: SnsMessage): string {
  const keys =
    m.Type === "Notification"
      ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"]
      : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"];
  return keys
    .filter((k) => m[k as keyof SnsMessage] !== undefined)
    .map((k) => `${k}\n${m[k as keyof SnsMessage]}\n`)
    .join("");
}

export type CertFetcher = (url: string) => Promise<string>;

const defaultFetcher: CertFetcher = async (url) => {
  const cached = certCache.get(url);
  if (cached) return cached;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error("certificate fetch failed");
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
};

/**
 * Verifies an SNS message: AWS-hosted cert, matching topic, fresh timestamp, valid
 * signature. Anything else is rejected before we touch the database.
 */
export async function verifySnsMessage(
  m: SnsMessage,
  opts: { topicArn: string; fetchCert?: CertFetcher; now?: Date; maxAgeMs?: number },
): Promise<boolean> {
  if (m.TopicArn !== opts.topicArn) return false;
  if (!isAwsSnsUrl(m.SigningCertURL, /\.pem$/)) return false;
  const age = (opts.now ?? new Date()).getTime() - new Date(m.Timestamp).getTime();
  if (!Number.isFinite(age) || age > (opts.maxAgeMs ?? 60 * 60 * 1000)) return false;
  try {
    const cert = await (opts.fetchCert ?? defaultFetcher)(m.SigningCertURL);
    const verifier = createVerify(m.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1");
    verifier.update(stringToSign(m), "utf8");
    return verifier.verify(cert, m.Signature, "base64");
  } catch {
    return false;
  }
}

/** SES event JSON (inside an SNS Notification) → our delivery event. */
export function parseSesEvent(message: string) {
  const e = JSON.parse(message) as {
    eventType?: string;
    notificationType?: string;
    mail: { messageId: string; timestamp: string };
    bounce?: { bounceType: string; bouncedRecipients?: { diagnosticCode?: string }[] };
    complaint?: { complaintFeedbackType?: string };
    reject?: { reason?: string };
  };
  const kind = (e.eventType ?? e.notificationType ?? "").toLowerCase();
  const type =
    kind === "delivery"
      ? "delivery"
      : kind === "bounce"
        ? "bounce"
        : kind === "complaint"
          ? "complaint"
          : kind === "reject"
            ? "reject"
            : kind === "deliverydelay"
              ? "delay"
              : null;
  if (!type) return null;
  return {
    messageId: e.mail.messageId,
    type,
    permanent: e.bounce?.bounceType === "Permanent",
    at: new Date().toISOString(),
    detail:
      e.bounce?.bouncedRecipients?.[0]?.diagnosticCode ??
      e.complaint?.complaintFeedbackType ??
      e.reject?.reason,
  } as const;
}
