import { EMAIL_CODE_LENGTH } from '@common';

// Branding taken from src/index.css (dark theme).
const COLORS = {
  page: '#121212',
  surface: '#1a1a1a',
  elevated: '#262626',
  borderSubtle: '#333333',
  border: '#404040',
  textPrimary: '#fbfefb',
  textMuted: '#878787',
  textDim: '#4d4d4d',
  accentGreen: '#19c233',
};

const FONT_BASE = "'DM Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

const TITLE_BY_PURPOSE: Record<'register' | 'reset' | 'change', { subject: string; heading: string; intro: string }> = {
  register: {
    subject: 'Your Ayphr verification code',
    heading: 'Verify your email',
    intro: 'Enter this code to finish creating your Ayphr account.',
  },
  reset: {
    subject: 'Your Ayphr password reset code',
    heading: 'Reset your password',
    intro: 'Enter this code to reset the password for your Ayphr account.',
  },
  change: {
    subject: 'Your Ayphr email confirmation code',
    heading: 'Confirm your email',
    intro: 'Enter this code to confirm your new email address for your Ayphr account.',
  },
};

import type { EmailCodePurpose } from '../db/internal';

export function buildCodeEmail(params: {
  purpose: EmailCodePurpose;
  code: string;
  ttlMinutes: number;
}): { subject: string; html: string; text: string } {
  const meta = TITLE_BY_PURPOSE[params.purpose];
  const subject = meta.subject;
  const ttlText = params.ttlMinutes === 1 ? '1 minute' : `${params.ttlMinutes} minutes`;

  const codeBox = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
      <tr>
        <td align="center" style="padding:20px 16px;background-color:${COLORS.elevated};border:1px solid ${COLORS.borderSubtle};border-radius:10px;">
          <span style="font-family:${FONT_MONO};font-size:34px;font-weight:700;letter-spacing:0.35em;color:${COLORS.textPrimary};text-decoration:none;">${escapeHtml(params.code)}</span>
        </td>
      </tr>
    </table>
  `;

  const bodyHtml = `
    <tr>
      <td style="padding:8px 32px 0;text-align:center;">
        <h1 style="margin:0 0 8px;font-family:${FONT_BASE};font-size:22px;font-weight:700;letter-spacing:-0.01em;color:${COLORS.textPrimary};">${escapeHtml(meta.heading)}</h1>
        <p style="margin:0 0 4px;font-family:${FONT_BASE};font-size:15px;line-height:1.5;color:${COLORS.textMuted};">${escapeHtml(meta.intro)}</p>
        <p style="margin:0;font-family:${FONT_BASE};font-size:13px;color:${COLORS.textDim};">Enter the ${EMAIL_CODE_LENGTH}-digit code below.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 32px;">${codeBox}</td>
    </tr>
    <tr>
      <td style="padding:0 32px 24px;text-align:center;">
        <p style="margin:0 0 6px;font-family:${FONT_BASE};font-size:13px;color:${COLORS.textMuted};">This code expires in <strong style="color:${COLORS.textPrimary};">${escapeHtml(ttlText)}</strong>.</p>
        <p style="margin:0;font-family:${FONT_BASE};font-size:12px;color:${COLORS.textDim};line-height:1.5;">If you didn't request this, you can ignore this email &mdash; nothing will happen.</p>
      </td>
    </tr>
  `;

  const html = renderLayout({ heading: meta.heading, bodyHtml, preview: `${meta.intro} Code: ${params.code}` });

  const text = `${meta.heading}

${meta.intro}

Your code: ${params.code}

This code expires in ${ttlText}.

If you didn't request this, you can ignore this email.

Ayphr
https://ayphr.com`;

  return { subject, html, text };
}

type LayoutParams = { heading: string; bodyHtml: string; preview: string };

function renderLayout({ bodyHtml, preview }: LayoutParams): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>Ayphr</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; display:block; }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${COLORS.page};">${escapeHtml(preview)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLORS.page};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:${COLORS.surface};border:1px solid ${COLORS.borderSubtle};border-radius:14px;">
          <tr>
            <td style="padding:28px 32px 0;text-align:center;">
              <span style="font-family:${FONT_BASE};font-size:20px;font-weight:800;letter-spacing:0.08em;color:${COLORS.textPrimary};text-decoration:none;">AYPHR</span>
            </td>
          </tr>
          ${bodyHtml}
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
          <tr>
            <td style="padding:16px 24px;text-align:center;">
              <p style="margin:0;font-family:${FONT_BASE};font-size:12px;color:${COLORS.textDim};line-height:1.5;">
                Sent by Ayphr &middot; <a href="https://ayphr.com" style="color:${COLORS.textMuted};text-decoration:none;">ayphr.com</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}