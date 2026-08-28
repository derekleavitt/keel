import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Transactional email.
 *
 * The interface is deliberately tiny — one function, four fields. Email providers differ
 * enormously in features nobody uses and not at all in the thing everyone needs, so the
 * abstraction covers only what every provider does. Anything richer belongs to a template
 * layer above this, not to the transport.
 *
 * **Nothing is sent in development.** Mail is written to `.keel/mail/` as readable files,
 * because the alternative — a real provider with a test key — eventually sends something
 * real to a real person, usually the day someone seeds the database with production data.
 */
export interface Email {
  to: string;
  subject: string;
  /** Plain text. Every client renders it, and it is what an assistive reader gets. */
  text: string;
  html?: string;
}

export interface EmailTransport {
  name: string;
  send: (email: Email) => Promise<void>;
}

/**
 * Writes each message to `.keel/mail/` instead of sending it.
 *
 * Filenames are timestamped and slugged so the directory reads chronologically, and the
 * body is written as-is so it can be opened in a browser.
 */
export function fileTransport(directory = '.keel/mail'): EmailTransport {
  return {
    name: 'file',
    async send(email) {
      await fs.mkdir(directory, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const slug = email.subject
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 50);
      const file = path.join(directory, `${stamp}-${slug}.txt`);

      await fs.writeFile(
        file,
        [
          `To: ${email.to}`,
          `Subject: ${email.subject}`,
          '',
          email.text,
          ...(email.html ? ['', '--- html ---', '', email.html] : []),
        ].join('\n'),
      );
    },
  };
}

/** Collects messages in memory. For tests, and for asserting what would have been sent. */
export function memoryTransport(): EmailTransport & { sent: Email[] } {
  const sent: Email[] = [];
  return {
    name: 'memory',
    sent,
    async send(email) {
      sent.push(email);
    },
  };
}

/**
 * Refuses to send.
 *
 * The default in production until a real provider is configured, so the failure is a loud
 * error in a job's dead-letter queue rather than mail silently vanishing. An email system
 * that quietly drops messages is worse than one that is obviously not set up.
 */
export function unconfiguredTransport(): EmailTransport {
  return {
    name: 'unconfigured',
    async send(email) {
      throw new Error(
        `No email transport configured — refusing to drop mail to ${email.to}. ` +
          'Set one up in packages/email/src/index.ts.',
      );
    },
  };
}

let transport: EmailTransport | undefined;

/** Swap the transport. Called once at startup, or by a test. */
export function setEmailTransport(next: EmailTransport): void {
  transport = next;
}

/**
 * The active transport.
 *
 * Lazy, like every other resource in this repo: choosing a transport at import time would
 * read the environment during `next build`.
 */
export function emailTransport(): EmailTransport {
  if (transport) return transport;
  transport = process.env.NODE_ENV === 'production' ? unconfiguredTransport() : fileTransport();
  return transport;
}

export async function sendEmail(email: Email): Promise<void> {
  await emailTransport().send(email);
}
