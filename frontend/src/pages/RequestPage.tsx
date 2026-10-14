import { AbandonedPanel } from '../components/request/AbandonedPanel';
import { ProcessingFailedPanel } from '../components/request/ProcessingFailedPanel';
import { ProcessingPanel } from '../components/request/ProcessingPanel';
import { RecorderPanel } from '../components/request/RecorderPanel';
import { DemoPanel } from '../components/request/DemoPanel';
import { ReportPanel } from '../components/request/ReportPanel';
import { RequestHeader } from '../components/request/RequestHeader';
import { SavingPanel } from '../components/request/SavingPanel';
import { useRequestPageController } from '../hooks/use-request-page-controller';

interface RequestPageProps {
  requestId: string;
  setNotice: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}

export function RequestPage({
  requestId,
  setNotice,
  onBusyChange,
}: RequestPageProps) {
  const controller = useRequestPageController({
    requestId,
    setNotice,
    onBusyChange,
  });
  const { current, local, frozen, saving } = controller;

  return (
    <section id="requestView">
      <RequestHeader
        requestId={requestId}
        current={current}
        statusLabel={controller.statusLabel}
        errorText={
          current?.status === 'processing_failed' ? '' : controller.errorText
        }
      />
      {current?.status === 'created' &&
        !frozen &&
        (current.kind === 'demo' ? (
          <DemoPanel controller={controller} />
        ) : (
          <RecorderPanel controller={controller} />
        ))}
      {saving && <SavingPanel controller={controller} />}
      {current?.status === 'processing' && <ProcessingPanel />}
      {current?.status === 'abandoned' && (
        <AbandonedPanel requestId={requestId} local={local} />
      )}
      {current?.status === 'processing_failed' && (
        <ProcessingFailedPanel controller={controller} />
      )}
      {current?.status === 'completed' && (
        <ReportPanel controller={controller} />
      )}
    </section>
  );
}
