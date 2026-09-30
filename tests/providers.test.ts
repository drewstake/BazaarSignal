import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderError, send } from "../functions/src/delivery";
const { createTransport, sendMail, close } = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));
vi.mock("nodemailer", () => ({ default: { createTransport } }));
const config = {
  email: "owner@example.test",
  from: "alerts@example.test",
  resendKey: "test-resend",
  discordToken: "test-discord",
  discordUser: "123456789123456789",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("Gmail SMTP adapter", () => {
  const gmail = {
    ...config,
    emailProvider: "gmail" as const,
    gmailUser: "sender@gmail.com",
    gmailPassword: "abcd efgh ijkl mnop",
  };
  it("authenticates over TLS and only sends to the configured owner", async () => {
    createTransport.mockReturnValue({ sendMail, close });
    sendMail.mockResolvedValue({ accepted: [config.email] });
    await send("email", "a1-created-email", "Alert created\nPrivate disable link", gmail);
    await send("email", "a1-created-email", "Alert created\nPrivate disable link", gmail);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: "smtp.gmail.com", port: 465, secure: true,
      auth: { user: gmail.gmailUser, pass: "abcdefghijklmnop" },
      disableFileAccess: true, disableUrlAccess: true,
    }));
    const message = sendMail.mock.calls[0][0];
    expect(message).toMatchObject({
      from: { name: "BazaarSignal", address: gmail.gmailUser },
      to: config.email, subject: "Alert created",
      text: "Alert created\nPrivate disable link",
    });
    expect(message.messageId).toBe(sendMail.mock.calls[1][0].messageId);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("sanitizes authentication failures and closes the connection", async () => {
    createTransport.mockReturnValue({ sendMail, close });
    sendMail.mockRejectedValue(Object.assign(new Error("private credentials"), { code: "EAUTH" }));
    await expect(send("email", "a1", "Alert", gmail)).rejects.toThrow("Gmail authentication failed; check the app password.");
    expect(close).toHaveBeenCalledOnce();
  });
  it("backs off temporary SMTP restrictions without exposing provider details", async () => {
    createTransport.mockReturnValue({ sendMail, close });
    sendMail.mockRejectedValue(Object.assign(new Error("private account"), { responseCode: 454 }));
    await expect(send("email", "a1", "Alert", gmail)).rejects.toMatchObject({
      message: "Gmail temporarily limited sending.", retryAfter: 3_600_000,
    });
  });
  it("does not mark an unaccepted recipient as delivered", async () => {
    createTransport.mockReturnValue({ sendMail, close });
    sendMail.mockResolvedValue({ accepted: [] });
    await expect(send("email", "a1", "Alert", gmail)).rejects.toThrow("Gmail did not accept the recipient.");
    expect(close).toHaveBeenCalledOnce();
  });
});
describe("notification HTTP adapters", () => {
  it("uses the configured owner recipient and stable email idempotency key", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "message1" })));
    vi.stubGlobal("fetch", fetch);
    await send("email", "w1-0-buy-email", "Target reached\nDetails", config);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers["Idempotency-Key"]).toBe("w1-0-buy-email");
    expect(JSON.parse(options.body)).toMatchObject({
      to: ["owner@example.test"],
      subject: "Target reached",
      text: "Target reached\nDetails",
    });
  });
  it("creates a DM for the configured recipient, disables mentions, and sends a deduplication nonce", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "channel1" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "message1" })));
    vi.stubGlobal("fetch", fetch);
    await send("discord", "w1-0-buy-discord", "Target reached", config);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      recipient_id: config.discordUser,
    });
    expect(fetch.mock.calls[1][0]).toBe(
      "https://discord.com/api/v10/channels/channel1/messages",
    );
    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.enforce_nonce).toBe(true);
    expect(body.nonce).toHaveLength(24);
  });
  it("preserves rate-limit retry information without exposing response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("private provider details", {
            status: 429,
            headers: { "retry-after": "120" },
          }),
        ),
    );
    try {
      await send("email", "w1-email", "Test", config);
      throw new Error("Expected failure");
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError);
      expect((e as ProviderError).retryAfter).toBe(120000);
      expect((e as Error).message).not.toContain("private");
    }
  });
});
