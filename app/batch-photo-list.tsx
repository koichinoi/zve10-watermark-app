'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Props = {
  files: File[];
  selected: File | null;
  rotations: Map<File, { rotation: number }>;
  busy: boolean;
  makeThumbnail: (file: File, signal: AbortSignal) => Promise<string>;
  onSelect: (file: File) => void;
  onRemove: (file: File) => void;
};
const pageSize = 9;
const cacheLimit = 45;

export default function BatchPhotoList({ files, selected, rotations, busy, makeThumbnail, onSelect, onRemove }: Props) {
  const [page, setPage] = useState(0);
  const [retry, setRetry] = useState(0);
  const cache = useRef(new Map<File, string | null>());
  const [thumbnails, setThumbnails] = useState(new Map<File, string | null>());
  const pageCount = Math.ceil(files.length / pageSize);
  const currentPage = Math.min(page, pageCount - 1);
  const visibleFiles = useMemo(() => files.slice(currentPage * pageSize, (currentPage + 1) * pageSize), [files, currentPage]);

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    const retained = new Set(files);
    for (const file of cache.current.keys()) if (!retained.has(file)) cache.current.delete(file);
    const run = async () => {
      for (const file of visibleFiles) {
        if (controller.signal.aborted) return;
        if (cache.current.has(file)) continue;
        let url: string | null = null;
        try { url = await makeThumbnail(file, controller.signal); }
        catch { /* A failed thumbnail still leaves the file selectable/removable. */ }
        if (controller.signal.aborted) return;
        cache.current.set(file, url);
        if (cache.current.size > cacheLimit) {
          const victim = [...cache.current.keys()].find((key) => !visibleFiles.includes(key));
          if (victim) cache.current.delete(victim);
        }
        setThumbnails(new Map(cache.current));
      }
    };
    void run();
    return () => controller.abort();
  }, [files, visibleFiles, busy, makeThumbnail, retry]);

  return <section className="photo-list" aria-label="已导入照片">
    <div className="photo-list-heading"><strong>已导入照片</strong><span>{files.length} 张</span></div>
    <p>点击缩略图查看；每张照片分别保留旋转和参数修改。</p>
    <ul>
      {visibleFiles.map((file, index) => {
        const url = thumbnails.get(file), failed = thumbnails.has(file) && !url;
        const rotation = rotations.get(file)?.rotation ?? 0;
        return <li key={`${currentPage * pageSize + index}-${file.name}`}>
          <button type="button" className="photo-list-select" aria-label={`查看照片 ${file.name}`} aria-pressed={selected === file} disabled={busy} onClick={() => onSelect(file)}>
            <span className="photo-list-image">
              {url ? /* eslint-disable-next-line @next/next/no-img-element */
                <img src={url} alt="" style={{ transform: `rotate(${rotation * 90}deg)` }} /> : <span>{failed ? '点击查看' : '生成中…'}</span>}
              {rotation !== 0 && <small>{rotation * 90}°</small>}
            </span>
            <span className="photo-list-name" title={file.name}>{file.name}</span>
          </button>
          <div className="photo-list-actions">
            <button type="button" aria-label={`移除照片 ${file.name}`} disabled={busy} onClick={() => onRemove(file)}>移除</button>
            {failed && <button type="button" aria-label={`重试缩略图 ${file.name}`} disabled={busy} onClick={() => { cache.current.delete(file); setRetry((value) => value + 1); }}>重试</button>}
          </div>
        </li>;
      })}
    </ul>
    {pageCount > 1 && <nav className="photo-list-pages" aria-label="照片列表分页">
      <button type="button" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button>
      <span>{currentPage + 1} / {pageCount}</span>
      <button type="button" disabled={busy || currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>下一页</button>
    </nav>}
    <small className="photo-list-note">移除仅影响本次导出，原文件保留在设备上。</small>
  </section>;
}
