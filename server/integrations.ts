import { v2 as cloudinary } from 'cloudinary';

export interface UploadResult {
  url: string;
  provider: 'cloudinary' | 'local';
}

export async function uploadToCloudinary(
  buffer: Buffer,
  fileName: string,
): Promise<UploadResult | null> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) return null;

  cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret });

  // Returning null instead of rejecting lets the caller fall back to local disk
  // storage, so an outage or a bad key degrades the upload rather than losing
  // the revision entirely.
  try {
    return await new Promise<UploadResult>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'pind-deliverables',
          resource_type: 'auto',
          use_filename: true,
          unique_filename: true,
          filename_override: fileName,
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error('Cloudinary upload failed'));
            return;
          }
          resolve({ url: result.secure_url, provider: 'cloudinary' });
        },
      );
      stream.on('error', reject);
      stream.end(buffer);
    });
  } catch (error) {
    console.error('Cloudinary upload failed, storing the file locally instead.', error);
    return null;
  }
}

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<{ sent: boolean; id?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Pind <onboarding@resend.dev>';

  if (!apiKey) return { sent: false };

  // A delivery failure must not block the invite: the caller still returns the
  // shareable review URL and records the activity, so the studio can copy the
  // link manually.
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, ...payload }),
    });

    if (!response.ok) {
      throw new Error(`Resend failed with ${response.status}`);
    }

    const body = (await response.json()) as { id?: string };
    return { sent: true, id: body.id };
  } catch (error) {
    console.error('Email delivery failed; the review link is still available to copy.', error);
    return { sent: false };
  }
}

export async function notifySlack(text: string): Promise<boolean> {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) return false;

  // Notifications are advisory; a webhook outage must never affect the
  // approval or comment that triggered it.
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed with ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error('Slack notification failed.', error);
    return false;
  }
}

export function integrationFlags(databaseMode: 'postgres' | 'file') {
  return {
    database: databaseMode === 'postgres',
    email: Boolean(process.env.RESEND_API_KEY),
    cloudinary: Boolean(
      process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET,
    ),
    slack: Boolean(process.env.SLACK_WEBHOOK_URL),
  };
}
