import { formatDate } from '../../shared/format';
import type { RequestRow } from '../../types';

interface RequestHeaderProps {
  requestId: string;
  current: RequestRow | null;
  statusLabel: string;
  errorText: string;
}

export function RequestHeader({
  requestId,
  current,
  statusLabel,
  errorText,
}: RequestHeaderProps) {
  return (
    <>
      <a href="#/requests" className="back">← Все приёмы</a>
      <div className="page-heading">
        <div>
          <p id="requestDate" className="eyebrow">
            {current ? formatDate(current.createdAt) : ''}
          </p>
          <h1>Приём</h1>
        </div>
        <span id="requestStatus" className="badge" role="status">{statusLabel}</span>
      </div>
      <p id="requestId" className="identifier">{requestId}</p>
      {errorText && <p id="requestError" className="error" role="alert">{errorText}</p>}
    </>
  );
}
