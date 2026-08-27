import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZV-E10 II 专属水印工坊',
  description: '本地读取照片 EXIF，自动生成 SONY ZV-E10 II 专属参数水印。',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

