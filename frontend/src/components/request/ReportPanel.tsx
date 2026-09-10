import { useEffect, useRef } from 'react';
import type { RequestPageController } from '../../hooks/use-request-page-controller';
import { downloadBlob } from '../../shared/download';

export function ReportPanel({ controller }: { controller: RequestPageController }) {
  const { report, reportHtml } = controller;
  const reportRef = useRef<HTMLElement>(null);

  useEffect(() => {
    for (const link of reportRef.current?.querySelectorAll('a') ?? []) {
      link.rel = 'noopener noreferrer';
    }
  }, [reportHtml]);

  return (
    <section id="reportPanel">
      <div className="report-toolbar">
        <h2>Отчёт</h2>
        <button
          id="downloadButton"
          className="secondary"
          disabled={!report}
          onClick={() => {
            if (report) {
              downloadBlob(
                new Blob([report.content], { type: 'text/markdown;charset=utf-8' }),
                `clinical_document_${report.requestId}.md`,
              );
            }
          }}
        >
          Скачать .md
        </button>
      </div>
      <article
        id="reportContent"
        ref={reportRef}
        className="report"
        dangerouslySetInnerHTML={{ __html: reportHtml }}
      />
    </section>
  );
}
