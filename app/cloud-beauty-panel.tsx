/* eslint-disable @next/next/no-img-element -- local blob previews must not use an image optimization server */
'use client';
import { useEffect, useRef, useState } from 'react';
import { readRasterSize } from './photo-processing';
import { beautyPrompt, customEditPrompt, cloudImage, cloudRequest } from './cloud-beauty';
type Props = { file: File | null; appliedFile?: File; busy: boolean; applied: boolean; setBusy: (value: boolean) => void; prepare: (input?: File) => Promise<Blob>; apply: (file: File | null) => Promise<void> };
export default function CloudBeauty({ file, appliedFile, busy, applied, setBusy, prepare, apply }: Props) {
  const [base, setBase] = useState(''); const [key, setKey] = useState(''); const [model, setModel] = useState('');
  const [models, setModels] = useState<string[]>([]); const [style, setStyle] = useState('自然调色'); const [strength, setStrength] = useState('轻微');
  const [instruction, setInstruction] = useState('');
  const [editSource, setEditSource] = useState<'latest' | 'original'>('latest');
  const [conversation, setConversation] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [consent, setConsent] = useState(false); const [message, setMessage] = useState(''); const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState<{ file: File; url: string; original: string; width: number; height: number } | null>(null);
  const controller = useRef<AbortController | null>(null); const urls = useRef<string[]>([]);
  const clear = () => { urls.current.forEach(URL.revokeObjectURL); urls.current = []; setPreview(null); };
  useEffect(() => { const timer = setTimeout(() => { if (['127.0.0.1', 'localhost'].includes(window.location.hostname)) setBase('/api/cloud'); }, 0); return () => clearTimeout(timer); }, []);
  useEffect(() => { const timer = setTimeout(() => { urls.current.forEach(URL.revokeObjectURL); urls.current = []; setPreview(null); setMessage(''); setConsent(false); setInstruction(''); setConversation([]); setEditSource('latest'); }, 0); return () => clearTimeout(timer); }, [file]);
  useEffect(() => () => { controller.current?.abort(); urls.current.forEach(URL.revokeObjectURL); }, []);
  const run = async (generate: boolean, custom = false) => {
    if (busy || controller.current) return;
    if (generate && (!file || !consent)) return;
    let prompt = beautyPrompt(style, strength);
    if (custom) { try { prompt = customEditPrompt(instruction); } catch (error) { setMessage(error instanceof Error ? error.message : '请输入修改要求'); return; } }
    const inputFile = custom && editSource === 'latest' ? preview?.file ?? appliedFile : undefined;
    const promptText = instruction.trim();
    if (custom) setConversation(items => [...items, { role: 'user', text: promptText }].slice(-19) as typeof items);
    const pendingUrls: string[] = [];
    const abort = new AbortController(); controller.current = abort; setWorking(true); setBusy(true); setMessage(generate ? '正在准备照片并请求美化…' : '正在读取模型…');
    const timer = setTimeout(() => abort.abort(), 300000);
    try {
      if (generate) {
        const input = await prepare(inputFile); abort.signal.throwIfAborted();
        const data = await cloudRequest({ base, key, model }, abort.signal, input, prompt);
        const output = await cloudImage(data, abort.signal);
        const size = await readRasterSize(output);
        if (!size || size.width * size.height > 32000000 || size.width > 16384 || size.height > 16384) throw new Error('生成图片尺寸过大或无法识别，请在服务端降低输出尺寸。');
        const url = URL.createObjectURL(output); pendingUrls.push(url);
        const image = new Image(); image.src = url; await image.decode(); abort.signal.throwIfAborted();
        if (image.naturalWidth * image.naturalHeight > 32000000) throw new Error('生成图片尺寸过大，请在服务端降低输出尺寸。');
        const original = URL.createObjectURL(input); pendingUrls.push(original);
        urls.current.forEach(URL.revokeObjectURL); urls.current = [...pendingUrls];
        if (custom) { setConversation(items => [...items, { role: 'assistant', text: '修改完成，请对比结果；可以继续提出要求，或应用到当前照片。' }].slice(-20) as typeof items); setInstruction(''); }
        setPreview({ file: output, url, original, width: image.naturalWidth, height: image.naturalHeight }); setMessage('美化完成，请对比后应用。');
      } else {
        const data = await cloudRequest({ base, key, model }, abort.signal) as { data?: { id?: unknown }[] };
        const ids = (Array.isArray(data.data) ? data.data : []).map((item) => item.id).filter((id): id is string => typeof id === 'string');
        setModels(ids); setMessage(`读取到 ${ids.length} 个模型，请选择支持图片编辑的模型。`);
      }
    } catch (error) { pendingUrls.forEach(URL.revokeObjectURL); const detail = abort.signal.aborted ? '已停止等待。服务端可能仍在处理和计费，请勿立即重复提交。' : error instanceof Error ? error.message : '请求失败。'; setMessage(detail); if (custom) setConversation(items => [...items, { role: 'assistant', text: detail + ' 上一版结果已保留。' }].slice(-20) as typeof items); }
    finally { clearTimeout(timer); controller.current = null; setWorking(false); setBusy(false); }
  };
  const applyResult = async (result: File | null) => { if (busy) return; setBusy(true); try { await apply(result); clear(); setMessage(result ? '已应用到当前照片，导出使用此结果。' : '已恢复原图。'); } catch (error) { setMessage(error instanceof Error ? error.message : '应用失败'); } finally { setBusy(false); } };
  return <details className="cloud-beauty"><summary>云端 AI 美化<span>通过你自己的 API</span></summary>
    <p>仅在点击发送后上传当前照片，可能产生服务费用。AI 可能改变细节，请先对比。原文件保留在设备上。</p>
    <fieldset disabled={busy}>
      <label>API 地址<input aria-label="API 地址" value={base} onChange={e => { setBase(e.target.value); setConsent(false); setModels([]); }} placeholder="https://你的服务/v1" autoComplete="off" /></label>
      <p>HTTP 局域网接口请使用本地连接版；线上版需 HTTPS 和服务端允许跨域。</p>
      <label>API Key<input aria-label="API Key" type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" spellCheck={false} /></label>
      <small>Key 仅保存在当前页面内存，刷新即清除。</small>
      <label>图片编辑模型<input aria-label="图片编辑模型" list="cloud-models" value={model} onChange={e => setModel(e.target.value)} placeholder="填写服务支持的图片编辑模型" /></label>
      <datalist id="cloud-models">{models.map(id => <option key={id} value={id} />)}</datalist>
      <button type="button" onClick={() => void run(false)}>读取模型列表</button>
      <label>美化风格<select value={style} onChange={e => setStyle(e.target.value)}><option>自然调色</option><option>自然人像</option><option>通透风景</option></select></label>
      <label>美化程度<select value={strength} onChange={e => setStrength(e.target.value)}><option>轻微</option><option>适中</option></select></label>
      <label className="cloud-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />同意将当前照片发送到上述 API 服务处理</label>
      <p>发送最长边 1536px 的无水印图片，去除原始 EXIF；ARW 使用内嵌预览。应用后按 AI 返回尺寸导出，本地调色和旋转继续生效。</p>
      <button type="button" disabled={!file || !consent || !base || !key || !model} onClick={() => void run(true)}>发送当前照片并美化</button>
      <section className="cloud-chat" aria-label="自定义修改对话">
        <h3>自定义修改对话</h3>
        <p>用自己的话描述修改。默认基于最新预览结果继续；应用后也能接着修改。每次发送会重新调用 API。</p>
        <div className="cloud-chat-log" role="log" aria-label="修改对话记录" aria-live="polite">{conversation.length ? conversation.map((entry, index) => <div key={index} className={'cloud-chat-message ' + entry.role}><strong>{entry.role === 'user' ? '你' : '修改状态'}</strong><p>{entry.text}</p></div>) : <p>例如：人物提亮一点，背景偏暖，保留皮肤纹理。</p>}</div>
        <label>修改基准<select aria-label="修改基准" value={editSource} onChange={e => setEditSource(e.target.value as 'latest' | 'original')}><option value="latest">最新结果（没有结果时使用原图）</option><option value="original">原始照片</option></select></label>
        <label htmlFor="cloud-edit-instruction">修改要求<textarea id="cloud-edit-instruction" rows={4} maxLength={2000} value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="例如：脸部稍微提亮，背景保持不变" /></label>
        <small>{instruction.length} / 2000 · 对话仅保留本张照片最近 10 轮，切换照片或刷新后清除。</small>
        <button type="button" disabled={!file || !consent || !base || !key || !model || !instruction.trim()} onClick={() => void run(true, true)}>发送修改要求</button>
        <button type="button" onClick={() => { setConversation([]); setInstruction(''); }}>清空对话</button>
      </section>
      {applied && <button type="button" onClick={() => void applyResult(null)}>恢复 AI 美化前的原图</button>}
    </fieldset>
    {working && <button type="button" onClick={() => controller.current?.abort()}>取消等待</button>}
    <p role="status">{message}</p>
    {preview && <><div className="cloud-comparison"><figure><figcaption>本次修改前</figcaption><img src={preview.original} alt="本次修改前图片" /></figure><figure><figcaption>AI 结果</figcaption><img src={preview.url} alt="AI 美化结果" /></figure></div><p>结果尺寸：{preview.width} × {preview.height}，请检查人物和构图。</p><button type="button" disabled={busy} onClick={() => void applyResult(preview.file)}>应用到当前照片</button><button type="button" disabled={busy} onClick={clear}>丢弃结果</button></>}
  </details>;
}
