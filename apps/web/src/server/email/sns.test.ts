import { createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isAwsSnsUrl, parseSesEvent, stringToSign, verifySnsMessage, type SnsMessage } from "./sns";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = publicKey.export({ type: "spki", format: "pem" }).toString();
const topicArn = "arn:aws:sns:ap-south-1:123456789012:ses-workspace-events";
const now = new Date("2026-10-16T10:00:00Z");

function signed(overrides: Partial<SnsMessage> = {}): SnsMessage {
  const m: SnsMessage = {
    Type: "Notification",
    MessageId: "abc",
    TopicArn: topicArn,
    Message: JSON.stringify({
      eventType: "Bounce",
      mail: { messageId: "m1", timestamp: now.toISOString() },
      bounce: { bounceType: "Permanent" },
    }),
    Timestamp: now.toISOString(),
    SignatureVersion: "2",
    Signature: "",
    SigningCertURL: "https://sns.ap-south-1.amazonaws.com/SimpleNotificationService-x.pem",
    ...overrides,
  };
  const signer = createSign("RSA-SHA256");
  signer.update(stringToSign(m));
  return { ...m, Signature: signer.sign(privateKey, "base64") };
}

const opts = { topicArn, fetchCert: async () => pem, now };

describe("verifySnsMessage", () => {
  it("accepts a correctly signed message", async () => {
    expect(await verifySnsMessage(signed(), opts)).toBe(true);
  });

  it("rejects tampered content", async () => {
    const m = signed();
    expect(
      await verifySnsMessage({ ...m, Message: m.Message.replace("Permanent", "Transient") }, opts),
    ).toBe(false);
  });

  it("rejects other topics, stale messages and non-AWS certificate URLs", async () => {
    expect(await verifySnsMessage(signed({ TopicArn: "arn:aws:sns:x:1:other" }), opts)).toBe(false);
    expect(await verifySnsMessage(signed({ Timestamp: "2026-10-16T07:00:00Z" }), opts)).toBe(false);
    expect(
      await verifySnsMessage(signed({ SigningCertURL: "https://evil.example.com/cert.pem" }), opts),
    ).toBe(false);
  });

  it("only trusts https SNS hosts (SSRF guard)", () => {
    expect(isAwsSnsUrl("https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription")).toBe(
      true,
    );
    expect(isAwsSnsUrl("http://sns.ap-south-1.amazonaws.com/x")).toBe(false);
    expect(isAwsSnsUrl("https://sns.ap-south-1.amazonaws.com.evil.com/x")).toBe(false);
    expect(isAwsSnsUrl("https://169.254.169.254/latest")).toBe(false);
  });
});

describe("parseSesEvent", () => {
  it("maps SES event types", () => {
    expect(parseSesEvent(signed().Message)).toMatchObject({
      messageId: "m1",
      type: "bounce",
      permanent: true,
    });
    expect(
      parseSesEvent(
        JSON.stringify({ eventType: "Delivery", mail: { messageId: "m2", timestamp: "" } }),
      )?.type,
    ).toBe("delivery");
    expect(
      parseSesEvent(
        JSON.stringify({ eventType: "Open", mail: { messageId: "m3", timestamp: "" } }),
      ),
    ).toBeNull();
  });
});
