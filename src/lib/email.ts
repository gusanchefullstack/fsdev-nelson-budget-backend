import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendEmail(to: string, subject: string, text: string) {
  if (!resend) {
    // Local development without a key: print the email instead of sending it.
    console.info(`[email] to=${to} subject="${subject}"\n${text}`);
    return;
  }
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Nelson <onboarding@resend.dev>",
    to,
    subject,
    text,
  });
  if (error) console.error("[email] send failed", error);
}
