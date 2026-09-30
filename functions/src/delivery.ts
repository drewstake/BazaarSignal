import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import type { Channel, Delivery } from "../../shared/model.js";
export const RETRY_DELAYS = [60_000, 300_000, 900_000, 3_600_000];
export function due(delivery: Delivery, now: number) {
  return (
    (delivery.status === "queued" || delivery.status === "sending") &&
    delivery.nextAttempt <= now &&
    delivery.leaseUntil <= now
  );
}
export function failedAttempt(
  delivery: Delivery,
  error: string,
  now: number,
  retryAfter = 0,
): Delivery {
  const terminal = delivery.attempts >= 5;
  return {
    ...delivery,
    status: terminal ? "failed" : "queued",
    leaseUntil: 0,
    error,
    nextAttempt:
      now +
      Math.max(RETRY_DELAYS[delivery.attempts - 1] ?? 3_600_000, retryAfter),
  };
}
export function pending(deliveries: Partial<Record<Channel, Delivery>>) {
  return Object.values(deliveries).some(
    (d) => d.status === "queued" || d.status === "sending",
  );
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
async function post(
  url: string,
  authorization: string,
  body: object,
  extra: Record<string, string> = {},
) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
      ...extra,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const retry = Number(res.headers.get("retry-after") ?? 0) * 1000;
    // Do not log response bodies, which can include recipients or credentials.
    throw new ProviderError(
      `Notification provider returned HTTP ${res.status}${res.status === 403 ? " (check DM permissions or sender verification)" : ""}.`,
      retry,
    );
  }
  return res.json() as Promise<Record<string, unknown>>;
}
export interface ProviderConfig {
  emailProvider?: "gmail" | "resend";
  gmailUser?: string;
  gmailPassword?: string;
  resendKey: string;
  from: string;
  email: string;
  discordToken: string;
  discordUser: string;
}
export function gmailTransport(config: ProviderConfig) {
  if (!config.gmailUser || !config.gmailPassword)
    throw new Error("Gmail sending authentication is not configured.");
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: config.gmailUser,
      pass: config.gmailPassword.replace(/\s/g, ""),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

async function sendGmail(id: string, message: string, config: ProviderConfig) {
  if (!config.email) throw new Error("Email recipient is not configured.");
  const transport = gmailTransport(config);
  try {
    const result = await transport.sendMail({
      from: { name: "BazaarSignal", address: config.gmailUser! },
      to: config.email,
      subject: message.split("\n")[0],
      text: message,
      // Stable across retries; SMTP does not guarantee deduplication.
      messageId: `<${createHash("sha256").update(id).digest("hex")}@bazaarsignal.web.app>`,
    });
    if (!result.accepted?.length)
      throw new ProviderError("Gmail did not accept the recipient.");
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    const failure = error as { code?: string; responseCode?: number };
    // SMTP error messages/responses can contain private account details.
    const reason = failure.code === "EAUTH"
      ? "Gmail authentication failed; check the app password."
      : failure.responseCode === 421 || failure.responseCode === 454
        ? "Gmail temporarily limited sending."
        : "Gmail could not confirm email delivery.";
    throw new ProviderError(reason, failure.responseCode === 421 || failure.responseCode === 454 ? 3_600_000 : 0);
  } finally {
    transport.close();
  }
}
export async function send(
  channel: Channel,
  id: string,
  message: string,
  config: ProviderConfig,
) {
  if (channel === "email") {
    if (config.emailProvider === "gmail") {
      await sendGmail(id, message, config);
      return;
    }
    if (!config.email || !config.resendKey || !config.from)
      throw new Error("Email service is not configured.");
    await post(
      "https://api.resend.com/emails",
      `Bearer ${config.resendKey}`,
      {
        from: config.from,
        to: [config.email],
        subject: message.split("\n")[0],
        text: message,
      },
      { "Idempotency-Key": id },
    );
  } else {
    if (!/^\d{16,22}$/.test(config.discordUser) || !config.discordToken)
      throw new Error("Discord service is not configured.");
    const channelData = await post(
      "https://discord.com/api/v10/users/@me/channels",
      `Bot ${config.discordToken}`,
      { recipient_id: config.discordUser },
    );
    if (typeof channelData.id !== "string")
      throw new Error("Discord returned an invalid channel.");
    await post(
      `https://discord.com/api/v10/channels/${channelData.id}/messages`,
      `Bot ${config.discordToken}`,
      {
        content: message.slice(0, 1900),
        allowed_mentions: { parse: [] },
        nonce: createHash("sha256").update(id).digest("hex").slice(0, 24),
        enforce_nonce: true,
      },
    );
  }
}
