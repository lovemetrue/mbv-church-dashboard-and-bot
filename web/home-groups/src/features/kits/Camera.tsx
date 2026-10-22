import { useEffect, useRef, useState } from 'react';
import { ru } from '../../shared/i18n/ru';
import { decodeFrame, frameOf, LIVE_SIDES } from './decode';
import styles from './Kits.module.css';

const t = ru.kits;

/** Как часто читать кадр: чаще телефон греется впустую, реже — заметная пауза после наведения. */
const SCAN_EVERY_MS = 150;

/**
 * Живая камера доступна только в защищённом контексте (https или localhost): по http браузер просто не даёт
 * `getUserMedia`. Тогда остаётся снимок через `<input capture>` — он работает и по http.
 */
export const liveCameraAvailable = (): boolean =>
  typeof window !== 'undefined' && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';

/**
 * Камера с распознаванием QR. Пока `paused` (на экране карточка найденного участника), кадры не читаются:
 * иначе тот же код, всё ещё в кадре, открывал бы карточку снова и снова. Поток камеры при этом не гасится,
 * чтобы следующий участник сканировался сразу, без нового запроса доступа.
 */
export function Camera({ paused, onCode, onError }: { paused: boolean; onCode: (text: string) => void; onError: (message: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  // Обработчики в ref: цикл чтения живёт с камерой, а не перезапускается на каждый рендер родителя.
  const handlers = useRef({ onCode, onError, paused });
  handlers.current = { onCode, onError, paused };

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    let turn = 0;

    const tick = () => {
      const video = videoRef.current;
      if (stopped || !video) return;
      if (!handlers.current.paused && video.readyState >= video.HAVE_CURRENT_DATA) {
        const side = LIVE_SIDES[turn++ % LIVE_SIDES.length]!;
        const frame = frameOf(video, video.videoWidth, video.videoHeight, side, canvas);
        const text = frame && decodeFrame(frame, false);
        if (text) handlers.current.onCode(text);
      }
      timer = window.setTimeout(tick, SCAN_EVERY_MS);
    };

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then(async (s) => {
        if (stopped) { s.getTracks().forEach((track) => track.stop()); return; }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        await video.play();
        setReady(true);
        tick();
      })
      .catch((err: unknown) => {
        if (stopped) return;
        const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        handlers.current.onError(denied ? t.cameraDenied : t.cameraFailed);
      });

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      // Без этого индикатор камеры на телефоне горит и после ухода с экрана.
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className={styles.camera}>
      {/* playsInline и muted: без них Safari на iPhone разворачивает видео на весь экран или не запускает его. */}
      <video ref={videoRef} className={styles.video} playsInline muted aria-label={t.cameraLabel} />
      <span className={styles.frame} aria-hidden="true" />
      {!ready && <span className={styles.cameraNote}>{t.cameraWaiting}</span>}
    </div>
  );
}
