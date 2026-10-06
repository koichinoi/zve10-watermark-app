'use client';

import { KeyboardEvent, PointerEvent, useEffect, useRef, useState } from 'react';
import { CustomIcon, IconCropSource, cropCustomIcon, fitArtwork, suggestIconCrop } from './custom-icons';
import { CropHandle, CropRect, adjustCrop, fullCrop } from './icon-crop';

type Props = { source: IconCropSource; label: string; onCancel: () => void; onApply: (icon: CustomIcon) => void };
const handles = [{ id: 'nw', name: '左上角' }, { id: 'ne', name: '右上角' }, { id: 'sw', name: '左下角' }, { id: 'se', name: '右下角' }] as const;

function CropPreview({ source, rect, dark }: { source: IconCropSource; rect: CropRect; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const image = source.image, width = image.naturalWidth * rect.width, height = image.naturalHeight * rect.height;
    const fit = fitArtwork(width, height, 170, 76);
    ctx.fillStyle = dark ? '#202125' : '#f7f7f4'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, rect.x * image.naturalWidth, rect.y * image.naturalHeight, width, height, (canvas.width - fit.width) / 2, (canvas.height - fit.height) / 2, fit.width, fit.height);
  }, [source, rect, dark]);
  return <figure><canvas ref={ref} width={200} height={100} aria-label={`${dark ? '深' : '浅'}色背景裁剪预览`} /><figcaption>{dark ? '深' : '浅'}色背景</figcaption></figure>;
}

export default function IconCropDialog({ source, label, onCancel, onApply }: Props) {
  const [suggestion] = useState(() => suggestIconCrop(source));
  const [rect, setRect] = useState<CropRect>(suggestion.rect);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; handle: CropHandle; x: number; y: number; rect: CropRect; width: number; height: number } | null>(null);
  useEffect(() => {
    const element = dialog.current!;
    const overflow = document.body.style.overflow;
    element.showModal(); document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = overflow; };
  }, []);
  const start = (event: PointerEvent<HTMLButtonElement>, handle: CropHandle) => {
    if (saving || !event.isPrimary || event.button !== 0 || drag.current) return;
    const bounds = wrap.current!.getBoundingClientRect();
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, handle, x: event.clientX, y: event.clientY, rect, width: bounds.width, height: bounds.height };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d?.id === event.pointerId) setRect(adjustCrop(d.rect, d.handle, (event.clientX - d.x) / d.width, (event.clientY - d.y) / d.height));
  };
  const stop = () => { drag.current = null; };
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, handle: CropHandle) => {
    const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = directions[event.key];
    if (!direction || saving) return;
    event.preventDefault();
    const step = event.shiftKey ? .03 : .005;
    setRect((current) => adjustCrop(current, handle, direction[0] * step, direction[1] * step));
  };
  const save = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try { onApply(await cropCustomIcon(source, rect)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '裁剪失败，请重试。'); setSaving(false); }
  };
  return (
    <dialog ref={dialog} className="icon-crop-dialog" aria-labelledby="icon-crop-title" aria-describedby="icon-crop-help" onCancel={(event) => { event.preventDefault(); if (!saving) onCancel(); }}>
      <div className="icon-crop-heading"><h2 id="icon-crop-title">裁剪{label}图标</h2><button type="button" disabled={saving} onClick={onCancel} aria-label="关闭裁剪">×</button></div>
      <p id="icon-crop-help">{suggestion.kind === 'none' ? '未找到可靠的留白边界，已保留完整图片。' : '已自动收紧四周留白，并保留少量边距。'}请检查机身、镜头和细小部件是否完整。</p>
      <div className="icon-crop-stage"><div className="icon-crop-image" ref={wrap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={source.url} alt="待裁剪的器材图片" draggable={false} />
        <div className="icon-crop-box" style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}>
          <button type="button" className="icon-crop-move" aria-label="移动裁剪框" disabled={saving} onPointerDown={(event) => start(event, 'move')} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={(event) => keyboard(event, 'move')} />
          {handles.map(({ id, name }) => <button key={id} type="button" className={`icon-crop-handle ${id}`} aria-label={`调整裁剪框${name}`} disabled={saving} onPointerDown={(event) => start(event, id)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onKeyDown={(event) => keyboard(event, id)} />)}
        </div>
      </div></div>
      <p className="icon-crop-tip">拖动框内移动，拖动四角调整；也可聚焦后用方向键微调。</p>
      <div className="icon-crop-tools"><button type="button" disabled={saving} onClick={() => setRect(suggestion.rect)}>自动裁边</button><button type="button" disabled={saving} onClick={() => setRect({ ...fullCrop })}>恢复完整图片</button></div>
      <div className="icon-crop-previews"><CropPreview source={source} rect={rect} dark={false} /><CropPreview source={source} rect={rect} dark /></div>
      <p className="icon-crop-tip">裁剪保留图片原有背景。仅应用后的图标保存在当前浏览器。</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="icon-crop-actions"><button type="button" disabled={saving} onClick={onCancel}>取消</button><button type="button" className="icon-crop-apply" disabled={saving} onClick={() => void save()}>{saving ? '正在应用…' : '应用裁剪'}</button></div>
    </dialog>
  );
}
