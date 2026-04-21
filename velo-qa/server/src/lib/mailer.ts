import { loadEnv } from '../env.js';
import { logger } from '../logger.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

// Dev mailer: logs the message so the recipient link is visible in the
// server console (see docs/ASSUMPTIONS.md A7).
class StdoutMailer implements Mailer {
  async send(mail: Mail): Promise<void> {
    logger.info(
      { to: mail.to, subject: mail.subject },
      `\n---- mail ----\nTo: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.text}\n---- end mail ----`,
    );
  }
}

export function createMailer(): Mailer {
  const env = loadEnv();
  if (env.NODE_ENV === 'production' && env.SMTP_URL) {
    // Production SMTP transport wires in here when we pull in nodemailer.
    // Kept as a TODO hook so MVP dev doesn't require SMTP creds.
    return new StdoutMailer();
  }
  return new StdoutMailer();
}
