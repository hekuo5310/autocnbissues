// 邮件发送 —— 基于 Cloudflare Email Service 的 send_email binding（新功能）
// 文档: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
// 前提: 发件域名已在 Cloudflare Dashboard → Email Service → Email Sending 完成 Onboard

import type { Env, SendEmailPayload } from './types';

const VERIFICATION_TTL_MIN = 10;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderVerificationEmailHtml(siteName: string, code: string, ttlMin: number): string {
  const digits = code
    .split('')
    .map(
      (d) =>
        `<td style="padding:0 6px;"><div style="width:52px;height:64px;line-height:64px;text-align:center;background:#161b22;border:1px solid #2f3742;border-radius:10px;color:#3ddc97;font-size:34px;font-weight:700;font-family:'SFMono-Regular',Consolas,monospace;">${d}</div></td>`,
    )
    .join('');
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
    <div style="background:#12161d;border:1px solid #232a33;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#123f33 0%,#12161d 60%);padding:24px 28px;">
        <div style="font-size:18px;font-weight:700;color:#f2f5f7;">${escapeHtml(siteName)}</div>
        <div style="font-size:13px;color:#8b949e;margin-top:4px;">邮箱验证码</div>
      </div>
      <div style="padding:28px;">
        <p style="margin:0 0 14px;color:#c9d1d9;font-size:14px;line-height:1.7;">你好！你正在登录（或注册）${escapeHtml(siteName)}。请使用下面的验证码完成验证：</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0;"><tr>${digits}</tr></table>
        <p style="margin:0 0 6px;color:#8b949e;font-size:13px;line-height:1.7;">验证码 <strong style="color:#c9d1d9;">${VERIFICATION_TTL_MIN} 分钟</strong>内有效，超时后需重新获取。</p>
        <p style="margin:0;color:#8b949e;font-size:13px;line-height:1.7;">如果这不是你本人的操作，请忽略本邮件，你的账号不会受到任何影响。</p>
      </div>
      <div style="border-top:1px solid #232a33;padding:16px 28px;color:#57606a;font-size:12px;line-height:1.6;">
        本邮件由系统自动发送，请勿回复。· ${escapeHtml(siteName)}
      </div>
    </div>
  </div>
</body></html>`;
}

export function renderVerificationEmailText(siteName: string, code: string, ttlMin: number): string {
  return `【${siteName}】你的邮箱验证码是：${code}\n\n验证码 ${ttlMin} 分钟内有效。如果这不是你本人的操作，请忽略本邮件。`;
}

/**
 * 发送验证码邮件。
 * 返回 true 表示已通过 send_email binding 发出；
 * DEV_MODE 下 binding 不可用时返回 false（调用方可以把验证码透出给开发环境）。
 */
export async function sendVerificationEmail(
  env: Env,
  to: string,
  code: string,
): Promise<{ sent: boolean; error?: string }> {
  const html = renderVerificationEmailHtml(env.SITE_NAME, code, VERIFICATION_TTL_MIN);
  const text = renderVerificationEmailText(env.SITE_NAME, code, VERIFICATION_TTL_MIN);

  const payload: SendEmailPayload = {
    to,
    from: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME },
    subject: `【${env.SITE_NAME}】你的验证码：${code}`,
    html,
    text,
  };

  try {
    if (!env.SEND_EMAIL || typeof env.SEND_EMAIL.send !== 'function') {
      throw new Error('SEND_EMAIL binding 未配置（检查 wrangler.jsonc 的 send_email 段）');
    }
    await env.SEND_EMAIL.send(payload);
    // 邮件发送成功事件（收件人脱敏），供 Workers Observability 检索
    const [toName, toDomain] = to.split('@');
    console.log(JSON.stringify({ event: 'email.sent', to: `${toName.slice(0, 2)}***@${toDomain}` }));
    return { sent: true };
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    console.error('[email] send failed:', err?.code, err?.message);
    return { sent: false, error: err?.code ? `${err.code}: ${err.message}` : err?.message ?? 'unknown' };
  }
}
