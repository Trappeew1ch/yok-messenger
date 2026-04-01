'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  useEffect(() => { router.replace('/chat'); }, [router]);
  return (
    <div style={{
      height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0A0A0F', color: '#EAEAEF', fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, fontWeight: 700 }}>YOK</div>
        <div style={{ color: '#55555F', marginTop: 8 }}>Перенаправление...</div>
      </div>
    </div>
  );
}
