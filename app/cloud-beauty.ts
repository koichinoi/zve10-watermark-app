export type CloudSettings = { base: string; key: string; model: string };
export function cloudBase(value: string, pageUrl: string): string {
  if (value === '/api/cloud' && ['localhost', '127.0.0.1'].includes(new URL(pageUrl).hostname)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('请填写完整 API 地址，包含 /v1。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API 地址格式不正确。');
  if (new URL(pageUrl).protocol === 'https:' && url.protocol === 'http:') throw new Error('线上 HTTPS 网页无法连接 HTTP 接口。请使用本地连接版，或为 API 配置 HTTPS。');
  return url.href.replace(/\/+$/, '');
}
export function beautyPrompt(style: string, strength: string): string {
  return `对上传的照片进行${strength}程度的${style}修饰。改善曝光、白平衡、肤色和自然细节，保留皮肤纹理。严格保持人物身份、五官、体型、服装、背景、构图、方向及长宽比，不增加或删除物体，不瘦脸、不放大眼睛、不添加文字或水印。输出修饰后的照片。`;
}
export async function limitedBlob(response: Response, maxBytes = 32 * 1024 * 1024): Promise<Blob> {
  if (!response.body) throw new Error('接口返回为空。');
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('接口结果过大，请降低生成尺寸。');
  const reader = response.body.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let total = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maxBytes) throw new Error('接口结果过大，请降低生成尺寸。'); chunks.push(new Uint8Array(value)); } }
  finally { await reader.cancel().catch(() => {}); }
  return new Blob(chunks, { type: response.headers.get('content-type') ?? '' });
}
export async function cloudRequest(settings: CloudSettings, signal: AbortSignal, image?: Blob, prompt?: string): Promise<unknown> {
  const base = cloudBase(settings.base.trim(), window.location.href);
  if (!settings.key.trim()) throw new Error('请填写 API Key。');
  const form = new FormData();
  if (image) {
    if (!settings.model.trim()) throw new Error('请选择或填写图片编辑模型。');
    form.append('model', settings.model.trim()); form.append('image', image, 'photo.png'); form.append('prompt', prompt ?? '自然修饰照片'); form.append('n', '1');
  }
  let response: Response;
  try { response = await fetch(base + (image ? '/images/edits' : '/models'), { method: image ? 'POST' : 'GET', headers: { Authorization: `Bearer ${settings.key.trim()}` }, body: image ? form : undefined, signal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' }); }
  catch (error) { if (signal.aborted) throw error; throw new Error('无法连接 API。请检查地址、跨域设置，或使用本地连接版。'); }
  if (!response.ok) {
    const messages: Record<number, string> = { 401: 'API Key 无效或未填写。', 403: '接口拒绝访问，请检查 Key 权限和分组。', 404: '接口或模型不存在，请确认支持 /images/edits。', 429: '额度不足或请求过多，请稍后检查。' };
    await response.body?.cancel();
    throw new Error(messages[response.status] ?? `图片服务请求失败（${response.status}），请检查服务后台。`);
  }
  try { return JSON.parse(await (await limitedBlob(response, 48 * 1024 * 1024)).text()); }
  catch (error) { if (signal.aborted) throw error; throw new Error('接口没有返回有效的 JSON 图片结果。'); }
}
export async function cloudImage(data: unknown, signal: AbortSignal): Promise<File> {
  const item = (data as { data?: { b64_json?: unknown; url?: unknown }[] })?.data?.[0];
  let blob: Blob;
  if (typeof item?.b64_json === 'string') {
    if (item.b64_json.length > 44 * 1024 * 1024) throw new Error('生成图片超过大小限制。');
    let raw: string; try { raw = atob(item.b64_json); } catch { throw new Error('生成图片编码无效。'); }
    blob = new Blob([Uint8Array.from(raw, (char) => char.charCodeAt(0))]);
  } else if (typeof item?.url === 'string') {
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('图片下载地址必须使用 HTTPS。请让 API 返回 b64_json。');
    const response = await fetch(url.href, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error' });
    if (!response.ok) throw new Error('生成图片下载失败。');
    blob = await limitedBlob(response);
  } else throw new Error('服务未返回图片，请确认所选模型支持图片编辑。');
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71;
  const jpeg = header[0] === 255 && header[1] === 216;
  const webp = String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp) throw new Error('服务返回的内容不是 PNG、JPEG 或 WEBP 图片。');
  return new File([blob], `cloud-result.${png ? 'png' : jpeg ? 'jpg' : 'webp'}`, { type: png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp' });
}
