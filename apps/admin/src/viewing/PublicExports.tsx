import { useEffect, useRef, useState } from 'react';
import { Download, FileDown, Printer } from 'lucide-react';
import type {
  PublicEventData,
  PublicMatchSnapshotData,
  PublicScheduleMatchData,
} from '@small-city-basketball/contracts';
import { ApiError } from '../api/client';
import {
  downloadPublicExport,
  matchCsv,
  matchPoster,
  POSTER_PAGE_SIZE,
  scheduleCsv,
  schedulePoster,
} from './exports';
import type { PublicExportFile } from './exports';

type ScheduleData = { event: PublicEventData; schedule: PublicScheduleMatchData[] };
type Props<T> = {
  data: T;
  disabled: boolean;
  readLatest: (signal: AbortSignal) => Promise<T>;
  onUnavailable: (cause: ApiError) => void;
};
function useExportAction<T>({ disabled, readLatest, onUnavailable }: Omit<Props<T>, 'data'>) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [poster, setPoster] = useState<PublicExportFile>();
  const mounted = useRef(true),
    sequence = useRef(0),
    current = useRef<AbortController | null>(null),
    disabledNow = useRef(disabled),
    busyNow = useRef(false);
  disabledNow.current = disabled;
  useEffect(() => {
    if (disabled) {
      ++sequence.current;
      current.current?.abort();
      busyNow.current = false;
      setBusy(false);
      setPoster(undefined);
      setMessage('');
    }
  }, [disabled]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++sequence.current;
      current.current?.abort();
    };
  }, []);
  async function run(
    build: (value: T, generatedAt: string) => PublicExportFile,
    mode: 'download' | 'print',
  ) {
    if (disabledNow.current || busyNow.current) return;
    const ticket = ++sequence.current;
    const controller = new AbortController();
    current.current?.abort();
    current.current = controller;
    busyNow.current = true;
    setBusy(true);
    setError('');
    setMessage('正在重新核验公开资料…');
    try {
      const latest = await readLatest(controller.signal);
      if (!mounted.current || ticket !== sequence.current || disabledNow.current) return;
      const asset = build(latest, new Date().toISOString());
      if (asset.mediaType.startsWith('image/svg+xml')) setPoster(asset);
      if (mode === 'download') {
        downloadPublicExport(asset);
        setMessage(`已生成 ${asset.filename}，请在浏览器下载列表查看。`);
      } else {
        setMessage('已生成本页海报，正在打开打印…');
        window.requestAnimationFrame(() => {
          if (!mounted.current || ticket !== sequence.current || disabledNow.current) return;
          try {
            window.print();
          } catch {
            setError('未能打开打印，请下载SVG海报后打印。');
          }
        });
      }
    } catch (cause) {
      if (!mounted.current || ticket !== sequence.current || disabledNow.current) return;
      setMessage('');
      setPoster(undefined);
      if (
        cause instanceof ApiError &&
        (cause.status === 404 || cause.apiCode === 'RESULT_SOURCE_INVALID')
      ) {
        onUnavailable(cause);
        return;
      }
      setError(cause instanceof Error ? cause.message : '导出失败，请重新读取公开资料后重试。');
    } finally {
      if (mounted.current && ticket === sequence.current) {
        busyNow.current = false;
        setBusy(false);
      }
    }
  }
  return { busy, message, error, poster, run };
}
function ExportNotice({ disabled }: { disabled: boolean }) {
  return (
    <p className="view-muted watch-export-notice">
      导出为静态公开资料快照，每次生成都会重新核验观赛授权。已下载文件无法远程撤回。
      {disabled ? '资料离线、陈旧或尚未完整读取，暂不可导出。' : '球员专业统计未统计。'}
    </p>
  );
}
function ExportResult({
  action,
  alt,
}: {
  action: ReturnType<typeof useExportAction>;
  alt: string;
}) {
  return (
    <>
      {action.message && <p role="status">{action.message}</p>}
      {action.error && (
        <p className="runtime-error" role="alert">
          {action.error}
        </p>
      )}
      {action.poster && (
        <figure className="watch-export-preview">
          <img
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(action.poster.body)}`}
            alt={alt}
          />
          <figcaption>本次生成的静态海报 · {action.poster.filename}</figcaption>
        </figure>
      )}
    </>
  );
}
export function ScheduleExportTools(props: Props<ScheduleData>) {
  const [selectedPage, setSelectedPage] = useState(1);
  const pageCount = Math.ceil(props.data.schedule.length / POSTER_PAGE_SIZE);
  const page = Math.max(1, Math.min(selectedPage, pageCount));
  const unavailable = props.disabled || props.data.schedule.length === 0;
  const action = useExportAction({ ...props, disabled: unavailable });
  const poster = (value: ScheduleData, at: string) =>
    schedulePoster(value.event, value.schedule, page, at);
  return (
    <section className="panel view-panel watch-export-tools" aria-label="公开赛程导出">
      <div className="watch-export-controls">
        <div>
          <h2>赛程与比分交付</h2>
          <p className="view-muted">
            CSV包含完整已读取公开赛程；海报每页最多{POSTER_PAGE_SIZE}场。
            {props.data.event.format === 'SINGLE_ELIMINATION' &&
              ' 淘汰赛仅导出当前已正式发布场次，轮空与待发布签位不生成比赛。'}
          </p>
        </div>
        <div className="watch-export-buttons">
          <label className="view-field">
            海报页码
            <select
              aria-label="海报页码"
              value={page}
              disabled={unavailable || action.busy}
              onChange={(event) => setSelectedPage(Number(event.target.value))}
            >
              {Array.from({ length: Math.max(pageCount, 1) }, (_, index) => (
                <option key={index} value={index + 1}>
                  第{index + 1} / {Math.max(pageCount, 1)}页
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-secondary"
            disabled={unavailable || action.busy}
            onClick={() =>
              void action.run(
                (value, at) => scheduleCsv(value.event, value.schedule, at),
                'download',
              )
            }
          >
            <FileDown size={16} />
            下载完整赛程CSV
          </button>
          <button
            className="button button-secondary"
            disabled={unavailable || action.busy}
            onClick={() => void action.run(poster, 'download')}
          >
            <Download size={16} />
            下载本页赛程海报SVG
          </button>
          <button
            className="button button-secondary"
            disabled={unavailable || action.busy}
            onClick={() => void action.run(poster, 'print')}
          >
            <Printer size={16} />
            打印本页海报
          </button>
        </div>
      </div>
      <ExportNotice disabled={unavailable} />
      <ExportResult action={action} alt="本次赛程海报预览" />
    </section>
  );
}
export function MatchExportTools(props: Props<PublicMatchSnapshotData>) {
  const action = useExportAction(props);
  return (
    <section className="panel view-panel watch-export-tools" aria-label="公开比分导出">
      <div className="watch-export-controls">
        <div>
          <h2>本场比分交付</h2>
          <p className="view-muted">包含当前赛果状态与生成时间，时钟导出后不会继续运行。</p>
        </div>
        <div className="watch-export-buttons">
          <button
            className="button button-secondary"
            disabled={props.disabled || action.busy}
            onClick={() => void action.run(matchCsv, 'download')}
          >
            <FileDown size={16} />
            下载本场数据CSV
          </button>
          <button
            className="button button-secondary"
            disabled={props.disabled || action.busy}
            onClick={() => void action.run(matchPoster, 'download')}
          >
            <Download size={16} />
            下载比分海报SVG
          </button>
          <button
            className="button button-secondary"
            disabled={props.disabled || action.busy}
            onClick={() => void action.run(matchPoster, 'print')}
          >
            <Printer size={16} />
            打印比分海报
          </button>
        </div>
      </div>
      <ExportNotice disabled={props.disabled} />
      <ExportResult action={action} alt="本次比分海报预览" />
    </section>
  );
}
