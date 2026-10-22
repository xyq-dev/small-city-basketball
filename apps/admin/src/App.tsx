import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FileText,
  Flag,
  FolderOpen,
  House,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  MapPin,
  Menu,
  PencilLine,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Tag,
  Trophy,
  UsersRound,
  Video,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { OrgRole } from '@small-city-basketball/contracts';
import type { CreateEventInput, EventRecord, EventRepository, EventStatus } from './domain/types';
import {
  EVENT_FORMAT_LABELS as formatLabels,
  EVENT_STATUS_LABELS as statusLabels,
} from './domain/types';
import { AppError, eventRepository } from './domain/repository';
import { validateEventInput } from './domain/validation';

const RepositoryContext = createContext<EventRepository>(eventRepository);
const useRepository = () => useContext(RepositoryContext);

export interface WorkspaceConfiguration {
  mode: 'mock' | 'api';
  organizationName: string;
  userDisplayName: string;
  role?: OrgRole;
  organizationSwitcher?: ReactNode;
  headerActions?: ReactNode;
}
const defaultWorkspace: WorkspaceConfiguration = {
  mode: 'mock',
  organizationName: '城市体育',
  userDisplayName: '示例管理员',
};
const WorkspaceContext = createContext<WorkspaceConfiguration>(defaultWorkspace);
const useWorkspace = () => useContext(WorkspaceContext);
function mayCreate(workspace: WorkspaceConfiguration) {
  return (
    workspace.mode === 'mock' || workspace.role === 'ORG_OWNER' || workspace.role === 'ORG_ADMIN'
  );
}
function mayEdit(workspace: WorkspaceConfiguration, event: EventRecord) {
  return (
    event.status === 'DRAFT' &&
    (workspace.mode === 'mock' || event.permissions?.canEditDraft === true)
  );
}
function CreationDenied() {
  return (
    <section className="panel empty-state runtime-route-denied">
      <ShieldCheck size={30} />
      <h1>当前身份不能创建赛事</h1>
      <p>
        仅机构负责人和机构管理员可以创建赛事。你可以查看已分配的赛事，编辑权限由服务器按赛事授予。
      </p>
      <Link className="button button-secondary" to="/events">
        查看可见赛事
      </Link>
    </section>
  );
}

const statusTone: Record<EventStatus, string> = {
  DRAFT: 'neutral',
  REGISTRATION_OPEN: 'blue',
  REGISTRATION_CLOSED: 'neutral',
  SCHEDULED: 'amber',
  RUNNING: 'green',
  COMPLETED: 'neutral',
  ARCHIVED: 'neutral',
  CANCELLED: 'red',
};
const roadmap: Record<
  string,
  { title: string; phase: string; description: string; icon: LucideIcon; points: string[] }
> = {
  registration: {
    title: '报名审核',
    phase: 'P03',
    description: '把球队报名、名单和资格审核放在同一条清晰的流程中。',
    icon: ClipboardCheck,
    points: ['球队与球员自行补齐资料', '本届参赛名单独立保存', '支持外购保险凭证提交'],
  },
  schedule: {
    title: '抽签排赛',
    phase: 'P04',
    description: '兼顾公平与现场安排，让每一次调赛都有据可查。',
    icon: CalendarDays,
    points: ['种子队与分组抽签', '球队、场地和休息时间冲突检查', '手动调赛与赛程版本记录'],
  },
  teams: {
    title: '球队与球员',
    phase: 'P03',
    description: '长期积累球队资料，保留每届赛事各自的名单。',
    icon: UsersRound,
    points: ['球队长期档案', '球员邀请与本人资料', '参赛授权与隐私分开管理'],
  },
  staff: {
    title: '工作人员',
    phase: 'P02',
    description: '把合适的权限分配给本届赛事的每个工作人员。',
    icon: ShieldCheck,
    points: ['机构与赛事范围授权', '记录员、审核员和直播员分工', '跨机构数据隔离'],
  },
  broadcast: {
    title: '直播与 OBS',
    phase: 'P06',
    description: '记分数据与直播包装共用同一场比赛，OBS 负责导播与推流。',
    icon: Radio,
    points: ['OBS 浏览器源只读包装', '实时比分、节次与计时', '品牌与赞助素材展示'],
  },
  delivery: {
    title: '内容与交付',
    phase: 'P06',
    description: '让赛事结束后，成绩和精彩时刻都有完整的交付。',
    icon: Video,
    points: ['确认赛果与成绩册', '回放及事件集锦', '视频状态与用量记录'],
  },
  sponsors: {
    title: '赞助管理',
    phase: '后续阶段',
    description: '为机构品牌和赞助伙伴保留清晰、可核对的展示位置。',
    icon: Tag,
    points: ['冠名与素材管理', '赛事及直播展示位', '真实统计口径与交付记录'],
  },
  plan: {
    title: '套餐与用量',
    phase: '后续阶段',
    description: '软件办赛服务与视频用量分别管理。',
    icon: ChartNoAxesCombined,
    points: ['按届服务与人工开通', '额度与到期规则', '视频成本独立核算'],
  },
  settings: {
    title: '机构设置',
    phase: 'P02',
    description: '机构资料、品牌与工作人员权限将在业务基础阶段接入。',
    icon: Settings2,
    points: ['机构资料与品牌', '工作人员邀请', '权限与操作审计'],
  },
};

function BrandMark({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 34 : 42}
      height={small ? 38 : 47}
      viewBox="0 0 48 54"
      fill="none"
      aria-hidden="true"
    >
      <path d="M3 26a21 21 0 1 1 42 0v14H3V26Z" fill="#FF773F" />
      <path
        d="M24 5v37M3 26h42M10 10c17 4 23 18 24 33M38 10C21 14 15 28 14 43"
        stroke="#132C49"
        strokeWidth="1.9"
      />
      <path
        d="M1 48h46M5 46V31h6v15m4 0V26h7v20m4 0V35h6v11m4 0V22h7v24"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path d="M39.5 22v-5" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function CourtArt({ compact = false, tone = 0 }: { compact?: boolean; tone?: number }) {
  const colors =
    tone % 3 === 1
      ? ['#2B5970', '#163B52', '#BD9373']
      : tone % 3 === 2
        ? ['#53556E', '#272F4A', '#E09B6B']
        : ['#24465D', '#102C44', '#E17D4B'];
  const id = `court-${tone}-${compact ? 's' : 'l'}`;
  return (
    <svg
      className={`court-art ${compact ? 'compact' : ''}`}
      viewBox="0 0 600 220"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="300" y1="0" x2="300" y2="220" gradientUnits="userSpaceOnUse">
          <stop stopColor={colors[0]} />
          <stop offset="1" stopColor={colors[1]} />
        </linearGradient>
        <linearGradient id={`${id}-sun`} x1="400" y1="40" x2="400" y2="180">
          <stop stopColor={colors[2]} stopOpacity=".4" />
          <stop offset="1" stopColor={colors[2]} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} d="M0 0h600v220H0z" />
      <circle cx="460" cy="78" r="102" fill={`url(#${id}-sun)`} />
      <g fill="#0C2337" opacity=".55">
        <path d="M0 95h27V63h19v32h18V48h28v47h24V71h23v24h15V42h20v53h31V61h29v34h24V51h21v44h24V74h25v21h18V37h22v58h29V61h18v34h25V48h28v47h23V69h18v26h36V34h28v61h21V57h22v38h27V77h27v18h35V61h30v34h15v125H0Z" />
      </g>
      <path d="M0 138h600" stroke="#B0CAD6" strokeOpacity=".14" />
      <g stroke="#D6E3E8" strokeOpacity=".4" strokeWidth="1.4" fill="none">
        <path d="m83 221 74-92h285l75 92M119 176h362M299 129v91" />
        <ellipse cx="299" cy="179" rx="50" ry="22" />
        <path d="m235 220 18-36h93l17 36M181 220c0-36 53-64 118-64s118 28 118 64" />
      </g>
      <g stroke="#BCCCD5" strokeWidth="2" opacity=".6">
        <path d="M451 98v62m-21-61h42v-21h-42z" />
        <path d="M440 100h20l-4 9h-12z" stroke="#F2A275" />
      </g>
      <g fill="#D4E2E9" opacity=".18">
        <circle cx="58" cy="47" r="1" />
        <circle cx="198" cy="20" r="1" />
        <circle cx="343" cy="35" r="1" />
      </g>
    </svg>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className={`status-badge ${statusTone[status]}`}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  );
}
function dateLabel(value: string) {
  return value.replaceAll('-', '.');
}
function dateRange(event: EventRecord) {
  return `${dateLabel(event.startDate)} — ${dateLabel(event.endDate)}`;
}
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '暂时无法完成操作，请稍后重试。';
}

function useEvents(query = '', status: EventStatus | 'ALL' = 'ALL') {
  const repository = useRepository();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void repository
      .list({ query, status })
      .then((data) => {
        if (active) setEvents(data);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, status, repository, retry]);
  return { events, loading, error, reload: () => setRetry((n) => n + 1) };
}

function LoadingState({ label = '正在读取赛事' }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={23} />
      <span>{label}…</span>
    </div>
  );
}
function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state error-state" role="alert">
      <span className="empty-icon">
        <CircleHelp size={27} />
      </span>
      <h3>暂时无法读取</h3>
      <p>{message}</p>
      {onRetry && (
        <button className="button button-secondary" onClick={onRetry}>
          重新加载
        </button>
      )}
    </div>
  );
}
function EmptyState({ filtered = false, onClear }: { filtered?: boolean; onClear?: () => void }) {
  const canCreate = mayCreate(useWorkspace());
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <FolderOpen size={30} />
      </span>
      <h3>
        {filtered
          ? '没有找到符合条件的赛事'
          : canCreate
            ? '你的第一场赛事，从这里开始'
            : '当前没有可见赛事'}
      </h3>
      <p>
        {filtered
          ? '试试其他名称或状态，也可以清空筛选。'
          : canCreate
            ? '创建赛事草稿，逐步完善你的办赛计划。'
            : '请等待机构管理员分配赛事，或切换到其他已获授权的机构。'}
      </p>
      {filtered ? (
        <button className="button button-secondary" onClick={onClear}>
          清空筛选
        </button>
      ) : canCreate ? (
        <Link className="button button-primary" to="/events/new">
          <Plus size={17} />
          创建赛事
        </Link>
      ) : null}
    </div>
  );
}

function SectionTitle({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      {children}
    </div>
  );
}

function EventCard({ event, index }: { event: EventRecord; index: number }) {
  return (
    <article className="event-card">
      <div className="event-card-art">
        <CourtArt compact tone={index} />
        <StatusBadge status={event.status} />
        <span className="event-card-mark">
          <Trophy size={22} />
        </span>
      </div>
      <div className="event-card-body">
        <h3>
          <Link to={`/events/${event.id}`}>{event.name}</Link>
        </h3>
        <p className="event-meta">
          <CalendarDays size={14} />
          {dateRange(event)}
        </p>
        <p className="event-meta">
          <MapPin size={14} />
          {event.venueName || '地点待定'}
        </p>
        <div className="event-card-bottom">
          <span>{formatLabels[event.format]}</span>
          <Link to={`/events/${event.id}`}>
            管理赛事
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </div>
    </article>
  );
}

function Dashboard() {
  const workspace = useWorkspace();
  const api = workspace.mode === 'api';
  const canCreate = mayCreate(workspace);
  const { events, loading, error, reload } = useEvents();
  const drafts = events.filter((event) => event.status === 'DRAFT');
  const editableDrafts = drafts.filter((event) => mayEdit(workspace, event));
  const metrics: { label: string; value: number; icon: LucideIcon; tone: string; note: string }[] =
    [
      {
        label: '全部赛事',
        value: events.length,
        icon: Trophy,
        tone: 'orange',
        note: api ? '当前机构可见赛事' : '本次演示中的赛事',
      },
      {
        label: '进行中',
        value: events.filter((e) => e.status === 'RUNNING').length,
        icon: Flag,
        tone: 'green',
        note: api ? '当前赛事状态' : '示例赛事状态',
      },
      {
        label: '报名中',
        value: events.filter((e) => e.status === 'REGISTRATION_OPEN').length,
        icon: UsersRound,
        tone: 'blue',
        note: api ? '当前赛事状态' : '示例赛事状态',
      },
      {
        label: '待完善草稿',
        value: drafts.length,
        icon: FileText,
        tone: 'purple',
        note: api ? '按赛事授权编辑' : '可以继续编辑',
      },
    ];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ORGANIZER WORKSPACE</div>
          <h1>
            欢迎回来，{workspace.organizationName}
            <span className="greeting-dot">。</span>
          </h1>
          <p>从第一届，到每一届。把每一场比赛都办得更好。</p>
        </div>
        <div className="date-display">
          <CalendarDays size={16} />
          {new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          }).format(new Date())}
        </div>
      </div>
      <section className="welcome-banner">
        <div className="welcome-copy">
          <span className="banner-kicker">
            <span />
            你的赛事主场，准备就绪
          </span>
          <h2>小城市，也有大主场。</h2>
          <p>从一份赛事草稿开始，让热爱有章可循。</p>
          <Link className="button button-white" to={canCreate ? '/events/new' : '/events'}>
            {canCreate ? '创建一届赛事' : '查看可见赛事'}
            <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="welcome-visual">
          <CourtArt />
          <span className="welcome-visual-note">MAKE EVERY GAME MATTER</span>
        </div>
      </section>
      {loading ? (
        <div className="panel">
          <LoadingState />
        </div>
      ) : error ? (
        <div className="panel">
          <ErrorState message={error} onRetry={reload} />
        </div>
      ) : (
        <>
          <section className="metric-grid" aria-label="赛事概览">
            {metrics.map(({ label, value, icon: Icon, tone, note }) => (
              <div className="metric-card" key={label}>
                <div className="metric-top">
                  <span>{label}</span>
                  <span className={`metric-icon ${tone}`}>
                    <Icon size={20} />
                  </span>
                </div>
                <strong>
                  {value}
                  <span>届</span>
                </strong>
                <div className="metric-note">
                  {note}
                  <ArrowUpRight size={14} />
                </div>
              </div>
            ))}
          </section>
          <div className="dashboard-grid">
            <section className="panel my-events-panel">
              <SectionTitle title="我的赛事" note="每一届赛事，都值得认真对待。">
                <Link className="text-link" to="/events">
                  查看全部
                  <ChevronRight size={15} />
                </Link>
              </SectionTitle>
              {events.length ? (
                <div className="event-card-grid">
                  {events.slice(0, 2).map((event, index) => (
                    <EventCard key={event.id} event={event} index={index} />
                  ))}
                </div>
              ) : (
                <EmptyState />
              )}
            </section>
            <section className="panel getting-started">
              <SectionTitle title="下一步，做什么？" />
              <div className="next-step-header">
                <span className="next-step-icon">
                  <PencilLine size={23} />
                </span>
                <div>
                  <strong>完善赛事草稿</strong>
                  <p>
                    {editableDrafts.length
                      ? `有 ${editableDrafts.length} 届草稿可以继续编辑`
                      : canCreate
                        ? '创建属于你的第一届赛事'
                        : '暂无可编辑草稿，请等待赛事授权'}
                  </p>
                </div>
              </div>
              {editableDrafts.slice(0, 2).map((event) => (
                <Link className="draft-task" key={event.id} to={`/events/${event.id}`}>
                  <span>
                    <FileText size={16} />
                    {event.name}
                  </span>
                  <ChevronRight size={16} />
                </Link>
              ))}
              {editableDrafts.length > 0 || canCreate ? (
                <Link
                  className="button button-secondary button-full"
                  to={editableDrafts[0] ? `/events/${editableDrafts[0].id}` : '/events/new'}
                >
                  {editableDrafts.length ? '继续完善' : '创建赛事'}
                  <ArrowRight size={15} />
                </Link>
              ) : (
                <p className="runtime-readonly">当前角色不可创建赛事；仅能编辑明确授权的草稿。</p>
              )}
              <div className="small-note">
                <Info size={14} />
                当前开放赛事草稿创建与编辑
              </div>
            </section>
          </div>
          <section className="panel workflow-panel">
            <SectionTitle title="从开赛准备，到赛后交付" note="分阶段建设，让每一步都落到实处。" />
            <div className="workflow-steps">
              {[
                { title: '创建赛事', note: '当前可体验', icon: Trophy, active: true },
                { title: '球队报名', note: 'P03 规划中', icon: UsersRound },
                { title: '抽签排赛', note: 'P04 规划中', icon: CalendarDays },
                { title: '现场记分', note: 'P05 规划中', icon: ClipboardCheck },
                { title: '直播与交付', note: 'P06 规划中', icon: Video },
              ].map(({ title, note, icon: Icon, active }, index) => (
                <div className={`workflow-step ${active ? 'active' : ''}`} key={title}>
                  <span className="workflow-icon">
                    <Icon size={20} />
                  </span>
                  <div>
                    <h3>{title}</h3>
                    <p>{note}</p>
                  </div>
                  {index < 4 && <ChevronRight className="workflow-chevron" size={17} />}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function EventsPage() {
  const workspace = useWorkspace();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<EventStatus | 'ALL'>('ALL');
  const { events, loading, error, reload } = useEvents(query, status);
  const filtered = Boolean(query.trim() || status !== 'ALL');
  const clear = () => {
    setQuery('');
    setStatus('ALL');
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">EVENT MANAGEMENT</div>
          <h1>赛事管理</h1>
          <p>把每一届赛事安排妥当，让每一个主场被看见。</p>
        </div>
        {mayCreate(workspace) && (
          <Link className="button button-primary" to="/events/new">
            <Plus size={18} />
            创建赛事
          </Link>
        )}
      </div>
      {workspace.mode === 'api' && !mayCreate(workspace) && (
        <p className="runtime-readonly">
          当前身份不能创建赛事；仅可查看分配的赛事，草稿编辑以每场授权为准。
        </p>
      )}
      <section className="panel events-panel">
        <div className="list-toolbar">
          <div className="list-toolbar-title">
            <span className="round-icon">
              <Trophy size={18} />
            </span>
            <h2>全部赛事</h2>
            {!loading && !error && <span className="count-badge">{events.length}</span>}
          </div>
          <div className="list-filters">
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="搜索赛事"
                placeholder="搜索赛事名称"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  className="icon-button compact"
                  onClick={() => setQuery('')}
                  aria-label="清空搜索"
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <label className="select-wrapper">
              <span className="sr-only">赛事状态</span>
              <select
                aria-label="赛事状态"
                value={status}
                onChange={(event) => setStatus(event.target.value as EventStatus | 'ALL')}
              >
                <option value="ALL">全部状态</option>
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown size={15} />
            </label>
            {filtered && (
              <button className="clear-filters" onClick={clear}>
                清空筛选
              </button>
            )}
          </div>
        </div>
        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : events.length === 0 ? (
          <EmptyState filtered={filtered} onClear={clear} />
        ) : (
          <>
            <div className="event-table-head" aria-hidden="true">
              <span>赛事名称</span>
              <span>比赛日期</span>
              <span>赛制 / 地点</span>
              <span>赛事状态</span>
              <span>操作</span>
            </div>
            <div className="event-table" aria-label="赛事列表">
              {events.map((event, index) => (
                <article className="event-table-row" key={event.id}>
                  <div className="event-name-cell">
                    <span className={`event-thumb thumb-${index % 3}`}>
                      <Trophy size={24} />
                    </span>
                    <div>
                      <Link to={`/events/${event.id}`}>{event.name}</Link>
                      <span className="event-subtitle">
                        {workspace.organizationName} ·{' '}
                        {workspace.mode === 'api' ? '机构赛事' : '演示赛事'}
                      </span>
                    </div>
                  </div>
                  <div className="table-dates">
                    <span>{dateLabel(event.startDate)}</span>
                    <span className="muted">至 {dateLabel(event.endDate)}</span>
                  </div>
                  <div className="table-venue">
                    <span>{formatLabels[event.format]}</span>
                    <span className="muted">
                      <MapPin size={12} />
                      {event.venueName || '地点待定'}
                    </span>
                  </div>
                  <div>
                    <StatusBadge status={event.status} />
                  </div>
                  <Link className="table-action" to={`/events/${event.id}`}>
                    管理
                    <ChevronRight size={14} />
                  </Link>
                </article>
              ))}
            </div>
            <div className="table-footer">
              <span>
                共 {events.length} 届赛事{filtered && ' · 当前筛选结果'}
              </span>
              <span>
                <ShieldCheck size={14} />
                {workspace.mode === 'api' ? '业务服务保存，刷新保留' : '演示数据，仅本次会话有效'}
              </span>
            </div>
          </>
        )}
      </section>
      <div className="tip-strip">
        <Info size={16} />
        <p>新建赛事将保存为草稿，可以在详情页继续编辑。报名、排赛和正式发布将在后续阶段开放。</p>
      </div>
    </>
  );
}

type FieldErrors = Partial<Record<keyof CreateEventInput, string>>;
const emptyInput = (): CreateEventInput => ({
  name: '',
  startDate: '',
  endDate: '',
  timezone: 'Asia/Shanghai',
  venueName: '',
  format: 'ROUND_ROBIN',
});
function EventForm({
  initial,
  onSave,
  onCancel,
  editing = false,
}: {
  initial?: CreateEventInput;
  onSave: (input: CreateEventInput) => Promise<void>;
  onCancel: () => void;
  editing?: boolean;
}) {
  const [input, setInput] = useState<CreateEventInput>(initial ?? emptyInput);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  function change<K extends keyof CreateEventInput>(field: K, value: CreateEventInput[K]) {
    setInput((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFailure('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    const nextErrors = validateEventInput(input);
    setErrors(nextErrors);
    setFailure('');
    const firstError = Object.keys(nextErrors).find(
      (key) => nextErrors[key as keyof CreateEventInput],
    );
    if (firstError) {
      document.getElementById(`field-${firstError}`)?.focus();
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    try {
      await onSave(input);
    } catch (cause) {
      if (cause instanceof AppError && cause.fieldErrors) setErrors(cause.fieldErrors);
      setFailure(errorMessage(cause));
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }
  const fieldProps = (name: keyof CreateEventInput) => ({
    id: `field-${name}`,
    'aria-invalid': Boolean(errors[name]),
    'aria-required': name !== 'venueName',
    'aria-describedby': errors[name] ? `error-${name}` : undefined,
  });
  const fieldError = (name: keyof CreateEventInput) =>
    errors[name] && (
      <span className="field-error" id={`error-${name}`}>
        {errors[name]}
      </span>
    );
  return (
    <form
      className="event-form"
      onSubmit={(event) => {
        void submit(event);
      }}
      noValidate
    >
      <div className="form-grid">
        <section className="panel form-main">
          <div className="form-section-title">
            <span className="step-number">01</span>
            <div>
              <h2>赛事基本信息</h2>
              <p>先保存草稿，其他办赛设置可在后续逐步完善。</p>
            </div>
          </div>
          <div className="form-fields">
            <label className="field-label" htmlFor="field-name">
              赛事名称 <span className="required">*</span>
            </label>
            <div className="text-input-wrap">
              <input
                {...fieldProps('name')}
                name="name"
                autoComplete="off"
                value={input.name}
                maxLength={160}
                placeholder="例如：2026 秋季城市联赛"
                onChange={(event) => change('name', event.target.value)}
              />
              <span className="input-counter">{Array.from(input.name).length}/80</span>
            </div>
            {fieldError('name')}
            <div className="field-hint">起一个让球员和观众容易记住的名字。</div>
            <div className="form-row">
              <div className="form-field">
                <label className="field-label" htmlFor="field-startDate">
                  开始日期 <span className="required">*</span>
                </label>
                <input
                  {...fieldProps('startDate')}
                  name="startDate"
                  type="date"
                  value={input.startDate}
                  onChange={(event) => change('startDate', event.target.value)}
                />
                {fieldError('startDate')}
              </div>
              <div className="form-field">
                <label className="field-label" htmlFor="field-endDate">
                  结束日期 <span className="required">*</span>
                </label>
                <input
                  {...fieldProps('endDate')}
                  name="endDate"
                  type="date"
                  value={input.endDate}
                  onChange={(event) => change('endDate', event.target.value)}
                />
                {fieldError('endDate')}
              </div>
            </div>
            <label className="field-label" htmlFor="field-venueName">
              比赛地点 <span className="optional">选填</span>
            </label>
            <div className="input-with-icon">
              <MapPin size={17} />
              <input
                {...fieldProps('venueName')}
                name="venueName"
                value={input.venueName ?? ''}
                maxLength={200}
                placeholder="填写球场或场馆名称"
                onChange={(event) => change('venueName', event.target.value)}
              />
            </div>
            {fieldError('venueName')}
            <div className="field-hint">尚未确定可以留空；填写地点不代表已预订场地。</div>
            <div className="timezone-field">
              <span>
                <Clock3 size={17} />
                赛事时区
              </span>
              <strong>
                中国标准时间 <span>Asia/Shanghai</span>
              </strong>
            </div>
            {fieldError('timezone')}
          </div>
        </section>
        <aside className="form-side">
          <section className="panel format-panel">
            <div className="form-section-title">
              <span className="step-number">02</span>
              <div>
                <h2>选择赛制</h2>
                <p>当前仅保存赛制配置</p>
              </div>
            </div>
            <fieldset className="format-options">
              <legend className="sr-only">赛事赛制</legend>
              {(
                [
                  {
                    value: 'ROUND_ROBIN',
                    label: '循环赛',
                    hint: '参赛球队按循环方式交锋',
                    icon: List,
                  },
                  {
                    value: 'GROUP_KNOCKOUT',
                    label: '分组后淘汰',
                    hint: '小组赛晋级后进行淘汰赛',
                    icon: LayoutGrid,
                  },
                  {
                    value: 'SINGLE_ELIMINATION',
                    label: '单淘汰赛',
                    hint: '逐轮淘汰，直至决出冠军',
                    icon: Trophy,
                  },
                ] as const
              ).map(({ value, label, hint, icon: Icon }) => (
                <label
                  className={`format-option ${input.format === value ? 'selected' : ''}`}
                  key={value}
                >
                  <input
                    type="radio"
                    name="format"
                    value={value}
                    checked={input.format === value}
                    onChange={() => change('format', value)}
                  />
                  <span className="format-option-icon">
                    <Icon size={19} />
                  </span>
                  <span>
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </span>
                  <span className="radio-indicator">{input.format === value && <span />}</span>
                </label>
              ))}
            </fieldset>
            {fieldError('format')}
          </section>
          <div className="form-aside-note">
            <ShieldCheck size={21} />
            <div>
              <strong>先创建，再完善</strong>
              <p>保存后仅生成草稿。不会自动发布赛事、开放报名或产生任何费用。</p>
            </div>
          </div>
        </aside>
      </div>
      {failure && (
        <div className="form-alert" role="alert">
          <CircleHelp size={19} />
          <div>
            <strong>保存未完成</strong>
            <p>{failure}</p>
            <span>已填写的内容仍保留，请检查后重试。</span>
          </div>
        </div>
      )}
      <div className="form-actions">
        <span>
          <FileText size={16} />
          {editing ? '修改仅影响当前草稿' : '保存为赛事草稿'}
        </span>
        <div>
          <button
            className="button button-secondary"
            type="button"
            disabled={submitting}
            onClick={onCancel}
          >
            取消
          </button>
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{' '}
            {submitting ? '正在保存…' : editing ? '保存修改' : '保存草稿'}
          </button>
        </div>
      </div>
    </form>
  );
}

function NewEventPage() {
  const workspace = useWorkspace();
  const repository = useRepository();
  const navigate = useNavigate();
  const requestGeneration = useRef(0);
  useEffect(() => {
    requestGeneration.current += 1;
    return () => {
      requestGeneration.current += 1;
    };
  }, [repository]);
  async function save(input: CreateEventInput) {
    if (!mayCreate(workspace))
      throw new AppError('INVALID_EVENT_STATE', '当前身份没有创建赛事的权限');
    const generation = requestGeneration.current;
    const event = await repository.create(input);
    if (generation === requestGeneration.current) {
      navigate(`/events/${event.id}`, { state: { created: true } });
    }
  }
  if (!mayCreate(workspace)) return <CreationDenied />;
  return (
    <>
      <Link className="back-link" to="/events">
        <ChevronLeft size={16} />
        返回赛事列表
      </Link>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CREATE YOUR NEXT EVENT</div>
          <h1>创建赛事</h1>
          <p>让新的一届，从一个好计划开始。</p>
        </div>
        <span className="draft-indicator">
          <span />
          新建草稿
        </span>
      </div>
      <EventForm onSave={save} onCancel={() => navigate('/events')} />
    </>
  );
}

function EventDetailPage() {
  const workspace = useWorkspace();
  const { id = '' } = useParams();
  const repository = useRepository();
  const location = useLocation();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  const requestGeneration = useRef(0);
  const created = Boolean((location.state as { created?: boolean } | null)?.created);
  useEffect(() => {
    let active = true;
    requestGeneration.current += 1;
    setEditing(false);
    setSaved(false);
    setEvent(null);
    setLoading(true);
    setError('');
    setNotFound(false);
    void repository
      .get(id)
      .then((record) => {
        if (active) setEvent(record);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(errorMessage(cause));
        setNotFound(cause instanceof AppError && cause.code === 'NOT_FOUND');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      requestGeneration.current += 1;
    };
  }, [id, repository, revision]);
  async function save(input: CreateEventInput) {
    if (!event) return;
    if (!mayEdit(workspace, event))
      throw new AppError('INVALID_EVENT_STATE', '当前身份没有编辑此草稿的权限');
    const generation = requestGeneration.current;
    const updated = await repository.updateDraft(event.id, input, event.version);
    if (generation !== requestGeneration.current) return;
    setEvent(updated);
    setEditing(false);
    setSaved(true);
  }
  if (loading)
    return (
      <div className="panel">
        <LoadingState label="正在读取赛事详情" />
      </div>
    );
  if (error || !event)
    return (
      <>
        <Link className="back-link" to="/events">
          <ChevronLeft size={16} />
          返回赛事列表
        </Link>
        <div className="panel">
          {notFound ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Search size={28} />
              </span>
              <h1>没有找到这届赛事</h1>
              <p>
                {workspace.mode === 'api'
                  ? '赛事不存在，或当前身份没有访问此赛事的权限。'
                  : '赛事可能不存在，或演示数据已在刷新后重置。'}
              </p>
              <Link className="button button-primary" to="/events">
                查看赛事列表
              </Link>
            </div>
          ) : (
            <ErrorState
              message={error || '赛事暂时不可用'}
              onRetry={() => setRevision((n) => n + 1)}
            />
          )}
        </div>
      </>
    );
  if (editing && mayEdit(workspace, event))
    return (
      <>
        <button className="back-link" onClick={() => setEditing(false)}>
          <ChevronLeft size={16} />
          返回赛事详情
        </button>
        <div className="page-heading">
          <div>
            <div className="eyebrow">EDIT EVENT DRAFT</div>
            <h1>编辑赛事</h1>
            <p>完善基本资料，为这一届做好准备。</p>
          </div>
          <StatusBadge status={event.status} />
        </div>
        <EventForm
          key={`${event.id}-${event.version}`}
          initial={{
            name: event.name,
            startDate: event.startDate,
            endDate: event.endDate,
            timezone: event.timezone,
            venueName: event.venueName ?? '',
            format: event.format,
          }}
          editing
          onSave={save}
          onCancel={() => setEditing(false)}
        />
      </>
    );
  return (
    <>
      <Link className="back-link" to="/events">
        <ChevronLeft size={16} />
        返回赛事列表
      </Link>
      {(created || saved) && (
        <div className="success-notice" role="status">
          <CheckCheck size={19} />
          {saved ? '修改已保存，列表与详情已更新。' : '赛事草稿已创建，可以继续完善基本信息。'}
        </div>
      )}
      <section className="event-detail-hero">
        <div className="detail-hero-copy">
          <div className="detail-kicker">
            <Trophy size={15} />
            {workspace.organizationName} <span>·</span> 赛事管理
          </div>
          <h1>{event.name}</h1>
          <div className="detail-hero-meta">
            <span>
              <CalendarDays size={15} />
              {dateRange(event)}
            </span>
            <span>
              <MapPin size={15} />
              {event.venueName || '地点待定'}
            </span>
          </div>
          <div className="detail-hero-actions">
            <StatusBadge status={event.status} />
            <span>{formatLabels[event.format]}</span>
          </div>
        </div>
        <div className="detail-hero-art">
          <CourtArt tone={1} />
        </div>
      </section>
      <div className="detail-grid">
        <section className="panel detail-info">
          <SectionTitle title="赛事基本信息">
            {mayEdit(workspace, event) && (
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  setEditing(true);
                  setSaved(false);
                }}
              >
                <PencilLine size={15} />
                编辑草稿
              </button>
            )}
          </SectionTitle>
          <dl className="detail-fields">
            <div>
              <dt>赛事名称</dt>
              <dd>{event.name}</dd>
            </div>
            <div>
              <dt>开始日期</dt>
              <dd>{dateLabel(event.startDate)}</dd>
            </div>
            <div>
              <dt>结束日期</dt>
              <dd>{dateLabel(event.endDate)}</dd>
            </div>
            <div>
              <dt>赛事时区</dt>
              <dd>
                Asia/Shanghai <span>（中国标准时间）</span>
              </dd>
            </div>
            <div>
              <dt>比赛地点</dt>
              <dd>{event.venueName || '待定'}</dd>
            </div>
            <div>
              <dt>赛制配置</dt>
              <dd>{formatLabels[event.format]}</dd>
            </div>
            <div>
              <dt>当前状态</dt>
              <dd>
                <StatusBadge status={event.status} />
              </dd>
            </div>
            <div>
              <dt>资料版本</dt>
              <dd>v{event.version}</dd>
            </div>
          </dl>
          {!mayEdit(workspace, event) && (
            <div className="readonly-note">
              <Info size={16} />
              <p>
                {workspace.mode === 'api'
                  ? event.status === 'DRAFT'
                    ? '当前身份仅可查看此赛事，没有编辑草稿的权限。'
                    : '当前赛事不是草稿，仅可查看资料。正式状态流转将在后续开放。'
                  : '此为非草稿示例赛事，当前原型仅允许编辑草稿。正式状态流转将在后续接入。'}
              </p>
            </div>
          )}
        </section>
        <aside className="detail-side">
          <section className="panel detail-progress">
            <SectionTitle title="办赛准备" />
            <div className="prepared-item">
              <span className="prepared-icon">
                <Check size={17} />
              </span>
              <div>
                <strong>赛事基本信息</strong>
                <p>
                  {mayEdit(workspace, event)
                    ? '草稿已保存，可继续编辑'
                    : workspace.mode === 'api'
                      ? '机构资料，只读展示'
                      : '示例资料，只读展示'}
                </p>
              </div>
              <span className="prepared-tag">可体验</span>
            </div>
            {[
              { title: '机构与工作人员', note: 'P02 规划中' },
              { title: '球队报名与名单', note: 'P03 规划中' },
              { title: '抽签与赛程', note: 'P04 规划中' },
            ].map(({ title, note }) => (
              <div className="prepared-item muted-item" key={title}>
                <span className="prepared-icon">
                  <Clock3 size={16} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{note}</p>
                </div>
              </div>
            ))}
          </section>
          <div className="mini-callout">
            <Info size={19} />
            <p>
              {workspace.mode === 'api'
                ? '赛事资料已由业务服务保存，刷新页面后保留。当前未接入收费、直播或保险购买。'
                : '本次演示数据保存在内存中，刷新页面后重置。保存草稿不会产生费用。'}
            </p>
          </div>
        </aside>
      </div>
      <section className="panel event-modules">
        <SectionTitle title="赛事功能" note="以下模块按项目计划逐步开放，当前仅展示规划入口。" />
        <div className="module-grid">
          {(['registration', 'schedule', 'broadcast', 'delivery'] as const).map((key) => {
            const item = roadmap[key]!;
            const Icon = item.icon;
            return (
              <Link className="module-card" to={`/roadmap/${key}`} key={key}>
                <span className="module-icon">
                  <Icon size={21} />
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <span>{item.phase} · 规划中</span>
                </div>
                <ChevronRight size={16} />
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}

function RoadmapPage() {
  const { module = '' } = useParams();
  const item = Object.hasOwn(roadmap, module) ? roadmap[module] : undefined;
  if (!item) return <NotFoundPage />;
  const Icon = item.icon;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">BUILDING THE NEXT CHAPTER</div>
          <h1>{item.title}</h1>
          <p>{item.description}</p>
        </div>
      </div>
      <section className="panel roadmap-panel">
        <span className="roadmap-symbol">
          <Icon size={38} />
        </span>
        <span className="roadmap-phase">{item.phase} · 规划中</span>
        <h2>每一项能力，都按计划落地。</h2>
        <p>当前可体验赛事草稿创建与编辑，本模块尚未接入真实业务。</p>
        <div className="roadmap-points">
          {item.points.map((point) => (
            <span key={point}>
              <Check size={16} />
              {point}
            </span>
          ))}
        </div>
        <Link className="button button-primary" to="/events">
          先去管理赛事
          <ArrowRight size={17} />
        </Link>
      </section>
    </>
  );
}
function NotFoundPage() {
  return (
    <div className="panel">
      <div className="empty-state">
        <span className="empty-icon">
          <MapPin size={30} />
        </span>
        <h1>这个页面还没有开场</h1>
        <p>请返回工作总览，继续管理你的赛事。</p>
        <Link className="button button-primary" to="/">
          返回工作总览
        </Link>
      </div>
    </div>
  );
}

const primaryNav: { label: string; to: string; icon: LucideIcon; planned?: boolean }[] = [
  { label: '工作总览', to: '/', icon: House },
  { label: '赛事管理', to: '/events', icon: Trophy },
  { label: '报名审核', to: '/roadmap/registration', icon: ClipboardCheck, planned: true },
  { label: '抽签排赛', to: '/roadmap/schedule', icon: CalendarDays, planned: true },
  { label: '球队与球员', to: '/roadmap/teams', icon: UsersRound, planned: true },
  { label: '工作人员', to: '/roadmap/staff', icon: ShieldCheck, planned: true },
  { label: '直播与 OBS', to: '/roadmap/broadcast', icon: Radio, planned: true },
  { label: '内容与交付', to: '/roadmap/delivery', icon: Video, planned: true },
  { label: '赞助管理', to: '/roadmap/sponsors', icon: Tag, planned: true },
];

function WorkspaceLayout() {
  const workspace = useWorkspace();
  const api = workspace.mode === 'api';
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const currentLabel =
    location.pathname === '/'
      ? '工作总览'
      : location.pathname === '/events/new'
        ? '创建赛事'
        : location.pathname.startsWith('/events/')
          ? '赛事详情'
          : location.pathname === '/events'
            ? '赛事管理'
            : (roadmap[location.pathname.split('/')[2] ?? '']?.title ?? '页面');
  useEffect(() => {
    setMenuOpen(false);
    document.title = `${currentLabel} · 小城市篮球`;
    window.scrollTo(0, 0);
  }, [location.pathname, currentLabel]);
  useEffect(() => {
    if (!menuOpen) return;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [menuOpen]);
  function closeMenu() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }
  function trapMenu(event: ReactKeyboardEvent<HTMLElement>) {
    if (!menuOpen) return;
    if (event.key === 'Escape') {
      closeMenu();
      return;
    }
    if (event.key !== 'Tab') return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'),
    );
    const first = controls[0],
      last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
  return (
    <div className={`app-shell ${api ? 'api-mode' : ''}`}>
      <a className="skip-link" href="#main-content">
        跳转至主要内容
      </a>
      {menuOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="关闭导航遮罩"
          onClick={closeMenu}
          tabIndex={-1}
        />
      )}
      <aside
        className={`sidebar ${menuOpen ? 'is-open' : ''}`}
        aria-label="机构工作台导航"
        role={menuOpen ? 'dialog' : undefined}
        aria-modal={menuOpen ? true : undefined}
        onKeyDown={trapMenu}
        onTransitionEnd={(event) => {
          if (
            menuOpen &&
            event.target === event.currentTarget &&
            event.propertyName === 'transform'
          ) {
            closeRef.current?.focus({ preventScroll: true });
          }
        }}
      >
        <div className="sidebar-brand">
          <Link to="/" aria-label="小城市篮球工作总览" onClick={() => setMenuOpen(false)}>
            <BrandMark />
            <span>
              <strong>小城市篮球</strong>
              <small>让热爱，有自己的主场</small>
            </span>
          </Link>
          <button
            className="icon-button sidebar-close"
            ref={closeRef}
            onClick={closeMenu}
            aria-label="关闭导航"
          >
            <X size={21} />
          </button>
        </div>
        <div className="org-switcher">
          {workspace.organizationSwitcher ?? (
            <>
              <span className="org-avatar">{Array.from(workspace.organizationName)[0]}</span>
              <div>
                <strong>{workspace.organizationName}</strong>
                <small>{api ? '当前机构' : '示例机构'}</small>
              </div>
              <span className="org-demo-label">{api ? '业务服务' : '演示'}</span>
            </>
          )}
        </div>
        <div className="nav-label">机构工作台</div>
        <nav aria-label="主要导航">
          {primaryNav.map(({ label, to, icon: Icon, planned }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <Icon size={19} />
              <span>{label}</span>
              {planned && <span className="nav-planned">规划</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <NavLink className="nav-item" to="/roadmap/plan" onClick={() => setMenuOpen(false)}>
            <ChartNoAxesCombined size={19} />
            <span>套餐与用量</span>
          </NavLink>
          <NavLink className="nav-item" to="/roadmap/settings" onClick={() => setMenuOpen(false)}>
            <Settings2 size={19} />
            <span>机构设置</span>
          </NavLink>
          <div className="sidebar-note">
            <span className="sidebar-note-dot" />
            <span>办赛工具，正在一步步完善</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-trigger"
              ref={menuButtonRef}
              aria-label="打开导航"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu size={22} />
            </button>
            <Link className="topbar-home" to="/">
              机构工作台
            </Link>
            <ChevronRight size={14} />
            <span className="breadcrumb-current">{currentLabel}</span>
          </div>
          <div className="topbar-right">
            <span className="demo-badge">
              <span />
              {api ? '本地 API' : '演示模式'}
            </span>
            <div className="topbar-divider" />
            <div className="user-profile">
              <span className="user-avatar">管</span>
              <span>{workspace.userDisplayName}</span>
            </div>
            {workspace.headerActions}
          </div>
        </header>
        <div className="demo-notice">
          <Info size={15} />
          <span>
            <strong>{api ? '业务服务 · 数据持久保存' : '演示模式 · Mock 数据'}</strong>
            <span className="notice-separator">—</span>
            {api
              ? '赛事数据通过本地 API 保存，刷新后保留；直播等后续模块尚未接入。'
              : '本次演示数据保存在内存中，刷新页面后重置。'}
          </span>
          <span className="notice-stage">{api ? 'P02 · 机构工作台' : 'P01 · 前端原型'}</span>
        </div>
        <main className="main-content" id="main-content" tabIndex={-1}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/new" element={<NewEventPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
            <Route path="/roadmap/:module" element={<RoadmapPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
        <footer className="workspace-footer">
          <span>
            小城市篮球 <span>·</span> 小城市，也有大主场。
          </span>
          <span>
            <ShieldCheck size={13} />
            {api
              ? '本地 API 与权限校验已接入，尚未部署生产服务'
              : '当前为前端演示，尚无真实登录与权限服务'}
          </span>
        </footer>
      </div>
    </div>
  );
}

export default function App({
  repository = eventRepository,
  workspace = defaultWorkspace,
}: {
  repository?: EventRepository;
  workspace?: WorkspaceConfiguration;
}) {
  return (
    <RepositoryContext.Provider value={repository}>
      <WorkspaceContext.Provider value={workspace}>
        <BrowserRouter>
          <WorkspaceLayout />
        </BrowserRouter>
      </WorkspaceContext.Provider>
    </RepositoryContext.Provider>
  );
}
