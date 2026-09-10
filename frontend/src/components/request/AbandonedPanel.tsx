import { useEffect, useState } from 'react';
import { requestStore } from '../../app/services';
import type { LocalRequest } from '../../types';

interface AbandonedPanelProps {
  requestId: string;
  local: LocalRequest | null;
}

export function AbandonedPanel({ requestId, local }: AbandonedPanelProps) {
  const [links, setLinks] = useState<Array<{ partNo: number; mimeType: string; url: string }>>([]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    if (!local?.audioStored && !local?.audioExpired) {
      void requestStore.parts(requestId).then((parts) => {
        if (!active) return;
        setLinks(
          parts.filter((part) => part.blob.size).map((part) => {
            const url = URL.createObjectURL(part.blob);
            urls.push(url);
            return { partNo: part.partNo, mimeType: part.mimeType, url };
          }),
        );
      });
    }
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [local?.audioExpired, local?.audioStored, requestId]);

  const hint = local?.audioStored
    ? 'Аудио сохранено на сервере; локальная копия удалена.'
    : local?.audioExpired
      ? 'Срок хранения локальной копии истёк.'
      : 'Локальная копия доступна для скачивания в течение 3 часов после закрытия.';

  return (
    <section id="abandonedPanel" className="panel">
      <h2>Приём закрыт без сохранения</h2>
      <p id="abandonedHint" className="muted">{hint}</p>
      <div id="recoveryDownloads" className="actions">
        {links.map((link) => (
          <a
            key={link.partNo}
            className="secondary"
            href={link.url}
            download={`part_${link.partNo}_${requestId}.${
              link.mimeType.includes('mp4') ? 'm4a' : link.mimeType.includes('ogg') ? 'ogg' : 'webm'
            }`}
          >
            Скачать часть {link.partNo}
          </a>
        ))}
      </div>
    </section>
  );
}
