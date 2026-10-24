import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  CircleHelp,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trophy,
  UserRound,
  UsersRound,
  Wallet,
  X,
} from 'lucide-react';
import type { ApiClient } from '../api/client';
import { createPlayerBookingApi } from '../api/player-booking';
import { ResourceState, useAction, useResource } from '../registration/shared';
import { Modal } from '../scoring/Dialogs';
import { bookingDemo } from './demo';
import type { DemoRole } from './demo';
import type {
  BookingAppearanceData,
  BookingCommandInput,
  BookingCreateInput,
  BookingOrderData,
  BookingPlayerData,
  BookingProfileInput,
  BookingRepository,
  BookingScope,
  BookingWorkspaceData,
} from './model';
import {
  commandId,
  fee,
  inputTime,
  isoTime,
  localTime,
  money,
  positionLabels,
  scopeLabels,
  shortDate,
  stateLabels,
} from './model';
import './booking.css';

export { isBookingPath } from './routes';
const tabs = [
  { to: '/players', label: '找球员', icon: UsersRound },
  { to: '/player-bookings', label: '我的预约', icon: ClipboardList },
  { to: '/player-center', label: '球员中心', icon: UserRound },
];
function Badge({ state, children }: { state?: string; children?: ReactNode }) {
  return (
    <span className={`bk-badge bk-${(state ?? 'neutral').toLowerCase()}`}>
      {children ?? stateLabels[state ?? ''] ?? state}
    </span>
  );
}
function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bk-empty">
      <UsersRound size={34} />
      <h2>{title}</h2>
      <div>{children}</div>
    </section>
  );
}
function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' }) {
  return (
    <div className={`bk-notice bk-notice-${tone}`}>
      <CircleHelp size={18} />
      <span>{children}</span>
    </div>
  );
}
function Heading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="bk-heading">
      <div>
        <span className="bk-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
function Avatar({
  player,
  demo,
  large = false,
}: {
  player: Pick<BookingPlayerData, 'id' | 'displayName' | 'position'>;
  demo: boolean;
  large?: boolean;
}) {
  const picture = demo && ['demo-guard', 'demo-center'].includes(player.id);
  return (
    <div
      className={`bk-avatar ${large ? 'bk-avatar-large' : ''} ${player.position === 'C' ? 'bk-center' : ''}`}
      aria-hidden="true"
    >
      {picture ? (
        <img
          src="/booking/players-demo.png"
          alt=""
          className={player.position === 'C' ? 'bk-picture-right' : ''}
        />
      ) : (
        <>
          <span className="bk-jersey-number">
            {player.position === 'PG' ? '7' : player.position === 'C' ? '15' : '23'}
          </span>
          <span className="bk-avatar-initial">{player.displayName.slice(0, 1)}</span>
        </>
      )}
    </div>
  );
}
export function BookingStandaloneApp({ client }: { client: ApiClient }) {
  return (
    <BrowserRouter>
      <BookingPage client={client} />
    </BrowserRouter>
  );
}
export function BookingPage({
  client,
  repository: providedRepository,
}: {
  client?: ApiClient;
  repository?: BookingRepository;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const demo = !client && !providedRepository;
  const repository = useMemo(
    () => providedRepository ?? (client ? createPlayerBookingApi(client) : bookingDemo.repository),
    [client, providedRepository],
  );
  const read = useCallback(() => repository.workspace(), [repository]);
  const resource = useResource(read);
  const [demoRole, setDemoRole] = useState<DemoRole>(bookingDemo.getRole());
  const [menuOpen, setMenuOpen] = useState(false);
  const data = resource.data;
  const path = location.pathname;
  useEffect(() => {
    setMenuOpen(false);
    window.scrollTo?.(0, 0);
  }, [path]);
  let page: ReactNode = null;
  if (data) {
    if (path === '/players') page = <Marketplace data={data} demo={demo} />;
    else if (path.startsWith('/players/'))
      page = (
        <PlayerDetails
          data={data}
          demo={demo}
          id={decodeURIComponent(path.slice('/players/'.length))}
        />
      );
    else if (path === '/player-bookings/new')
      page = (
        <BookingForm
          key={location.search}
          data={data}
          repository={repository}
          demo={demo}
          onCreated={(id) => {
            resource.reload();
            navigate(`/player-bookings/${encodeURIComponent(id)}`);
          }}
        />
      );
    else if (path === '/player-bookings') page = <Orders data={data} reload={resource.reload} />;
    else if (path.startsWith('/player-bookings/'))
      page = (
        <OrderDetails
          data={data}
          repository={repository}
          id={decodeURIComponent(path.slice('/player-bookings/'.length))}
          reload={resource.reload}
          demo={demo}
        />
      );
    else if (path === '/player-center')
      page = (
        <PlayerCenter data={data} repository={repository} demo={demo} reload={resource.reload} />
      );
    else if (path === '/player-bookings-admin')
      page = <Operations data={data} repository={repository} reload={resource.reload} />;
    else
      page = (
        <Empty title="没有找到这个预约页面">
          <Link to="/players">返回找球员</Link>
        </Empty>
      );
  }
  return (
    <div className="booking-app">
      <a className="bk-skip" href="#booking-main">
        跳转到主要内容
      </a>
      <header className="bk-header">
        <div className="bk-header-inner">
          <Link to="/players" className="bk-brand">
            <span className="bk-brand-ball">
              <Trophy size={23} />
            </span>
            <span>
              小城市篮球<small>球员赛事预约</small>
            </span>
          </Link>
          <nav className="bk-desktop-nav" aria-label="球员预约导航">
            {tabs.map((t) => (
              <NavLink
                to={t.to}
                end={t.to != '/players'}
                key={t.to}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                {t.label}
              </NavLink>
            ))}
            {data?.isPlatformOperator && <NavLink to="/player-bookings-admin">平台运营</NavLink>}
          </nav>
          <div className="bk-header-right">
            <span className="bk-city">
              <MapPin size={15} />
              高州
            </span>
            <a href="/" className="bk-back-workspace">
              赛事工作台
              <ArrowRight size={15} />
            </a>
            <button
              className="bk-icon-button bk-menu-button"
              aria-label="打开预约导航"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <SlidersHorizontal size={21} />
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="bk-mobile-menu" aria-label="更多预约导航">
            {tabs.map((t) => (
              <Link to={t.to} key={t.to}>
                {t.label}
              </Link>
            ))}
            {data?.isPlatformOperator && <Link to="/player-bookings-admin">平台运营</Link>}
            <a href="/">返回赛事工作台</a>
          </nav>
        )}
      </header>
      {demo && (
        <div className="bk-demo-bar">
          <span>
            <Sparkles size={15} />
            <strong>交互演示</strong> · 合成球员与订单，刷新后重置，不发生资金交易
          </span>
          <label>
            体验身份
            <select
              aria-label="演示身份"
              value={demoRole}
              onChange={(e) => {
                const role = e.target.value as DemoRole;
                bookingDemo.setRole(role);
                setDemoRole(role);
                resource.reload();
              }}
            >
              <option value="buyer">球队领队</option>
              <option value="player">预约球员</option>
              <option value="operator">平台运营</option>
            </select>
          </label>
        </div>
      )}
      <main id="booking-main" className="bk-main" tabIndex={-1}>
        {resource.loading || resource.error ? (
          <ResourceState
            loading={resource.loading}
            error={resource.error}
            reload={resource.reload}
          />
        ) : (
          page
        )}
      </main>
      <footer className="bk-footer">
        <span>小城市，也有大主场。</span>
        <p>球员自主接单 · 费用清晰展示 · 逐场履约记录</p>
        <small>线上支付、退款及分账尚未接通；入驻资料审核不等于实名、参赛资格或保险核验。</small>
      </footer>
      <nav className="bk-bottom-nav" aria-label="手机预约导航">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to != '/players'}>
            <t.icon size={21} />
            <span>{t.label}</span>
          </NavLink>
        ))}
        {data?.isPlatformOperator && (
          <NavLink to="/player-bookings-admin">
            <ShieldCheck size={21} />
            <span>运营</span>
          </NavLink>
        )}
      </nav>
    </div>
  );
}
function Marketplace({ data, demo }: { data: BookingWorkspaceData; demo: boolean }) {
  const [search, setSearch] = useState(''),
    [position, setPosition] = useState('ALL'),
    [sort, setSort] = useState('recommended'),
    [date, setDate] = useState('');
  const players = data.players
    .filter(
      (p) =>
        (position === 'ALL' || p.position === position) &&
        (!search || `${p.displayName} ${p.city} ${p.bio}`.includes(search)) &&
        (!date ||
          p.availability.some(
            (w) =>
              Date.parse(`${date}T00:00:00+08:00`) < Date.parse(w.endAt) &&
              Date.parse(`${date}T23:59:59+08:00`) > Date.parse(w.startAt),
          )),
    )
    .sort((a, b) =>
      sort === 'price-up'
        ? a.priceFen - b.priceFen
        : sort === 'price-down'
          ? b.priceFen - a.priceFen
          : a.displayName.localeCompare(b.displayName, 'zh-CN'),
    );
  return (
    <>
      <section className="bk-hero">
        <div className="bk-hero-copy">
          <span className="bk-hero-kicker">
            <span />
            本地球员 · 按需预约
          </span>
          <h1>
            这场比赛，
            <br />
            找到合适的<span>队友。</span>
          </h1>
          <p>
            从一场比赛到整个赛季。
            <br className="bk-mobile-break" />
            按位置选球员，把时间和地点一次说清。
          </p>
          <div className="bk-hero-actions">
            <a href="#player-market" className="bk-button bk-primary">
              寻找我的队友
              <ArrowRight size={18} />
            </a>
            <Link to="/player-center" className="bk-hero-link">
              我是球员，申请入驻
              <ChevronRight size={16} />
            </Link>
          </div>
          <div className="bk-hero-points">
            <span>
              <CheckCircle2 size={15} />
              单场 / 系列赛
            </span>
            <span>
              <CheckCircle2 size={15} />
              球员自主接单
            </span>
            <span>
              <CheckCircle2 size={15} />
              逐场履约记录
            </span>
          </div>
        </div>
        <div className="bk-hero-visual">
          <img src="/booking/players-demo.png" alt="身穿深蓝橙色球衣的篮球球员场景示意" />
          <span className="bk-visual-label">场景示意图</span>
          <div className="bk-hero-float">
            <span className="bk-float-icon">
              <CalendarDays size={23} />
            </span>
            <div>
              <strong>一场，到一整个赛季</strong>
              <small>固定场次与晋级意向分别管理</small>
            </div>
          </div>
        </div>
      </section>
      <div className="bk-feature-strip">
        <div>
          <UsersRound />
          <span>
            <strong>按位置找人</strong>
            <small>后卫、锋线、中锋</small>
          </span>
        </div>
        <div>
          <CalendarDays />
          <span>
            <strong>把档期约清楚</strong>
            <small>单场、多场、整届赛事</small>
          </span>
        </div>
        <div>
          <Wallet />
          <span>
            <strong>费用提前知道</strong>
            <small>参赛费、交通食宿单列</small>
          </span>
        </div>
      </div>
      <section id="player-market" className="bk-market">
        <div className="bk-section-head">
          <div>
            <span className="bk-eyebrow">FIND YOUR TEAMMATE</span>
            <h2>
              球员广场 <small>{players.length} 位可查看</small>
            </h2>
          </div>
          <Link to="/player-bookings" className="bk-text-link">
            我的预约
            <ArrowRight size={16} />
          </Link>
        </div>
        <div className="bk-filter-panel">
          <div className="bk-search">
            <Search size={19} />
            <input
              aria-label="搜索球员"
              placeholder="搜索球员姓名、地区或技术特点"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                className="bk-icon-button"
                aria-label="清空搜索"
                onClick={() => setSearch('')}
              >
                <X size={17} />
              </button>
            )}
          </div>
          <div className="bk-filter-row">
            <div className="bk-chips" aria-label="球员位置筛选">
              {[['ALL', '全部位置'], ...Object.entries(positionLabels)].map(([key, label]) => (
                <button
                  key={key}
                  className={position === key ? 'active' : ''}
                  aria-pressed={position === key}
                  onClick={() => setPosition(key!)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="bk-filter-fields">
              <label>
                <CalendarDays size={15} />
                <input
                  type="date"
                  aria-label="可约日期"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <select aria-label="球员排序" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="recommended">默认排序</option>
                <option value="price-up">参赛费从低到高</option>
                <option value="price-down">参赛费从高到低</option>
              </select>
            </div>
          </div>
        </div>
        {players.length ? (
          <div className="bk-player-grid">
            {players.map((p) => (
              <article className="bk-player-card" key={p.id}>
                <Link
                  className="bk-player-picture"
                  to={`/players/${encodeURIComponent(p.id)}`}
                  tabIndex={-1}
                >
                  <Avatar player={p} demo={demo} />
                  <span className="bk-position-label">{positionLabels[p.position]}</span>
                </Link>
                <div className="bk-player-card-body">
                  <div className="bk-player-name">
                    <Link to={`/players/${encodeURIComponent(p.id)}`}>
                      <h3>{p.displayName}</h3>
                    </Link>
                    <span className="bk-reviewed">
                      <ShieldCheck size={13} />
                      资料已审核
                    </span>
                  </div>
                  <p className="bk-player-meta">
                    {p.heightCm}cm <span>·</span> {p.city}
                  </p>
                  <p className="bk-player-bio">{p.bio}</p>
                  <div className="bk-card-bottom">
                    <span className="bk-price">
                      {money(p.priceFen)}
                      <small> / 场或约定时段</small>
                    </span>
                    <Link
                      className="bk-button bk-outline bk-small"
                      to={`/players/${encodeURIComponent(p.id)}`}
                    >
                      查看档期
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty title="暂时没有符合条件的球员">
            <p>调整位置、日期或搜索词后再试。真实资料不会用演示球员补齐。</p>
            <button
              className="bk-button bk-outline"
              onClick={() => {
                setSearch('');
                setPosition('ALL');
                setDate('');
              }}
            >
              清空筛选
            </button>
          </Empty>
        )}
      </section>
      <Notice>
        球员广场显示的是入驻资料审核结果。参赛资格由赛事规则与报名要求决定，预约前请先核对。
      </Notice>
    </>
  );
}
function PlayerDetails({
  data,
  demo,
  id,
}: {
  data: BookingWorkspaceData;
  demo: boolean;
  id: string;
}) {
  const p = data.players.find((p) => p.id === id);
  if (!p)
    return (
      <Empty title="球员当前不可查看">
        <p>资料可能尚未审核、已经停用或访问链接有误。</p>
        <Link to="/players">返回球员广场</Link>
      </Empty>
    );
  return (
    <>
      <Link className="bk-back" to="/players">
        <ArrowLeft size={17} />
        返回球员广场
      </Link>
      <div className="bk-detail-layout">
        <section className="bk-player-profile">
          <div className="bk-profile-picture">
            <Avatar player={p} demo={demo} large />
            {demo && <small>合成人物示意</small>}
          </div>
          <div className="bk-profile-info">
            <Badge state={p.status} />
            <h1>{p.displayName}</h1>
            <p>
              {positionLabels[p.position]} · {p.city}
            </p>
            <div className="bk-profile-metrics">
              <div>
                <strong>
                  {p.heightCm}
                  <small>cm</small>
                </strong>
                <span>身高 · 球员填写</span>
              </div>
              <div>
                <strong>
                  {p.availability.length}
                  <small>个</small>
                </strong>
                <span>可约时间窗口</span>
              </div>
              <div>
                <strong>{positionLabels[p.position]}</strong>
                <span>主打位置</span>
              </div>
            </div>
            <h2>关于这位队友</h2>
            <p className="bk-bio-long">{p.bio}</p>
            <Notice>尚未采集真实比赛视频和能力评分，不以示意人物或审核状态代替实力证明。</Notice>
          </div>
        </section>
        <aside className="bk-panel bk-booking-aside">
          <span className="bk-eyebrow">BOOK A PLAYER</span>
          <h2>预约参赛服务</h2>
          <strong className="bk-detail-price">
            {money(p.priceFen)}
            <small> / 场或约定时段</small>
          </strong>
          <dl className="bk-fee-list">
            <div>
              <dt>平台服务费（{data.settings.feeBps / 100}%）</dt>
              <dd>{money(fee(p.priceFen, data.settings.feeBps))}</dd>
            </div>
            <div>
              <dt>交通报价 / 场</dt>
              <dd>{money(p.travelFen)}</dd>
            </div>
            <div>
              <dt>食宿报价 / 场</dt>
              <dd>{money(p.accommodationFen)}</dd>
            </div>
          </dl>
          <Link
            to={`/player-bookings/new?playerId=${encodeURIComponent(p.id)}`}
            className="bk-button bk-primary"
          >
            预约这位球员
            <ArrowRight size={18} />
          </Link>
          <small>提交预约后仍需球员确认；当前线上支付及分账未接通。</small>
        </aside>
      </div>
      <section className="bk-panel bk-availability">
        <div className="bk-section-head">
          <div>
            <span className="bk-eyebrow">AVAILABILITY</span>
            <h2>球员公布的可约档期</h2>
          </div>
          <CalendarDays size={24} />
        </div>
        {p.availability.map((w, i) => (
          <div className="bk-window" key={i}>
            <span className="bk-window-dot" />
            <strong>{localTime(w.startAt, true)}</strong>
            <ArrowRight size={15} />
            <strong>{localTime(w.endAt, true)}</strong>
            <span>可提交预约，最终以接单为准</span>
          </div>
        ))}
        <p className="bk-muted">
          每次预约按完整服务时段检查冲突，并预留交通缓冲；条件意向不占用档期。
        </p>
      </section>
    </>
  );
}

type Slot = {
  key: string;
  label: string;
  conditional: boolean;
  conditionText: string;
  reportAt: string;
  startAt: string;
  endAt: string;
  venue: string;
  matchId?: string;
};
function initialSlot(index = 0): Slot {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + 7 + index * 2);
  const date = d.toISOString().slice(0, 10);
  return {
    key: commandId(),
    label: `第${index + 1}场比赛`,
    conditional: false,
    conditionText: '球队晋级后确认',
    reportAt: `${date}T19:00`,
    startAt: `${date}T19:30`,
    endAt: `${date}T21:00`,
    venue: '',
  };
}
function BookingForm({
  data,
  repository,
  onCreated,
  demo,
}: {
  data: BookingWorkspaceData;
  repository: BookingRepository;
  onCreated: (id: string) => void;
  demo: boolean;
}) {
  const location = useLocation();
  const [quoteData, setQuoteData] = useState(data);
  const initialId =
    new URLSearchParams(location.search).get('playerId') ?? quoteData.players[0]?.id ?? '';
  const [selected, setSelected] = useState<string[]>([initialId].filter(Boolean)),
    [scope, setScope] = useState<BookingScope>('SINGLE'),
    [teamId, setTeamId] = useState(data.teams[0]?.id ?? ''),
    [eventId, setEventId] = useState(''),
    [eventName, setEventName] = useState(''),
    [slots, setSlots] = useState<Slot[]>([initialSlot()]),
    [eligibility, setEligibility] = useState(false),
    [rules, setRules] = useState(false),
    [validation, setValidation] = useState('');
  const action = useAction();
  const requestId = useRef(commandId());
  const team = data.teams.find((t) => t.id === teamId);
  const chosen = quoteData.players.filter((p) => selected.includes(p.id));
  const fixed = slots.filter((s) => !s.conditional),
    conditional = slots.filter((s) => s.conditional);
  const sum = (count: number, field: 'priceFen' | 'travelFen' | 'accommodationFen') =>
    chosen.reduce((n, p) => n + p[field] * count, 0);
  const services = sum(fixed.length, 'priceFen'),
    platform = chosen.reduce(
      (n, p) => n + fee(p.priceFen, quoteData.settings.feeBps) * fixed.length,
      0,
    ),
    travel = sum(fixed.length, 'travelFen'),
    accommodation = sum(fixed.length, 'accommodationFen'),
    total = services + platform + travel + accommodation;
  const conditionalTotal = chosen.reduce(
    (n, p) =>
      n +
      (p.priceFen + p.travelFen + p.accommodationFen + fee(p.priceFen, quoteData.settings.feeBps)) *
        conditional.length,
    0,
  );
  function updateSlot(key: string, patch: Partial<Slot>) {
    setSlots((rows) => rows.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }
  function changeScope(next: BookingScope) {
    setScope(next);
    if (next === 'SINGLE') setSlots((rows) => [{ ...rows[0]!, conditional: false }]);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setValidation('');
    if (slots.length * chosen.length > 64) {
      setValidation('每份预约最多64项球员场次，请拆分提交。');
      return;
    }
    if (!team || !chosen.length) {
      setValidation('请先选择有授权的球队与球员。');
      return;
    }
    if (!eventName.trim()) {
      setValidation('请填写赛事或合作名称。');
      return;
    }
    if (!eligibility || !rules) {
      setValidation('请核对参赛资格并阅读预约规则后再提交。');
      return;
    }
    if (scope === 'SINGLE' && slots.length !== 1) {
      setValidation('单场预约仅能包含一个比赛时段。');
      return;
    }
    if (
      slots.some(
        (s) =>
          !s.label.trim() ||
          !s.venue.trim() ||
          (!s.conditional &&
            (!s.reportAt ||
              !s.startAt ||
              !s.endAt ||
              s.reportAt > s.startAt ||
              s.startAt >= s.endAt)) ||
          (s.conditional && !s.conditionText.trim()),
      )
    ) {
      setValidation('请补全每场名称、地点、有效时间或触发条件。');
      return;
    }
    const input: BookingCreateInput = {
      commandId: requestId.current,
      reviewedSettingsVersion: quoteData.settings.version,
      reviewedProfileVersions: Object.fromEntries(chosen.map((p) => [p.id, p.version])),
      orgId: team.orgId,
      teamId: team.id,
      ...(eventId ? { eventId } : {}),
      eventName: eventName.trim(),
      scope,
      eligibilityConfirmed: true,
      appearances: slots.flatMap((s) =>
        chosen.map((p) => ({
          profileId: p.id,
          ...(s.matchId ? { matchId: s.matchId } : {}),
          label: s.label.trim(),
          conditional: s.conditional,
          ...(s.conditional
            ? { conditionText: s.conditionText.trim() }
            : {
                reportAt: isoTime(s.reportAt),
                startAt: isoTime(s.startAt),
                endAt: isoTime(s.endAt),
              }),
          venue: s.venue.trim(),
        })),
      ),
    };
    await action.run(async () => {
      const o = await repository.create(input);
      onCreated(o.id);
    }, '预约已提交');
  }
  if (!data.teams.length)
    return (
      <>
        <Heading eyebrow="NEW RESERVATION" title="先选择有授权的球队" />
        <Empty title="当前账号没有可下单的球队">
          <p>请由机构授予球队管理权限后再预约。个人球员账号可以先维护入驻资料。</p>
          <Link className="bk-button bk-primary" to="/player-center">
            进入球员中心
          </Link>
        </Empty>
      </>
    );
  return (
    <>
      <Link className="bk-back" to="/players">
        <ArrowLeft size={17} />
        返回找球员
      </Link>
      <Heading eyebrow="MAKE A RESERVATION" title="把下一场，也把整个赛程约清楚">
        一份合作预约，逐人逐场确认。先核对赛程与费用，再交给球员选择。
      </Heading>
      <form className="bk-checkout-layout" onSubmit={(e) => void submit(e)}>
        <div className="bk-form-main">
          <section className="bk-panel">
            <h2 className="bk-number-title">
              <span>01</span>选择合作方式
            </h2>
            <div className="bk-scope-grid">
              {(Object.entries(scopeLabels) as [BookingScope, string][]).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className={scope === key ? 'active' : ''}
                  aria-pressed={scope === key}
                  onClick={() => changeScope(key)}
                >
                  <CalendarDays size={20} />
                  <strong>{label}</strong>
                  <small>
                    {key === 'SINGLE'
                      ? '一场比赛'
                      : key === 'MULTI'
                        ? '指定多场'
                        : key === 'TOURNAMENT'
                          ? '小组赛与晋级场次'
                          : key === 'SEASON'
                            ? '明确周期、逐场预约'
                            : '明确开始与结束'}
                  </small>
                </button>
              ))}
            </div>
          </section>
          <section className="bk-panel">
            <h2 className="bk-number-title">
              <span>02</span>球队与预约球员
            </h2>
            <div className="bk-form-grid">
              <label>
                代表球队
                <select
                  required
                  value={teamId}
                  onChange={(e) => {
                    setTeamId(e.target.value);
                    setEventId('');
                    setEventName('');
                  }}
                >
                  {data.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                关联已有赛事
                <select
                  value={eventId}
                  onChange={(e) => {
                    const event = data.events.find((v) => v.id === e.target.value);
                    setEventId(e.target.value);
                    if (event) setEventName(event.name);
                  }}
                >
                  <option value="">其他比赛 / 手工填写</option>
                  {data.events
                    .filter((e) => e.orgId === team?.orgId)
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="bk-span-2">
                赛事或合作名称
                <input
                  required
                  maxLength={80}
                  value={eventName}
                  placeholder="例如：青锋杯、周六联赛"
                  onChange={(e) => setEventName(e.target.value)}
                />
              </label>
            </div>
            <fieldset className="bk-player-select">
              <legend>选择球员（可选多人）</legend>
              {quoteData.players.map((p) => (
                <label className={selected.includes(p.id) ? 'active' : ''} key={p.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected((ids) =>
                        e.target.checked ? [...ids, p.id] : ids.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <Avatar player={p} demo={demo} />
                  <span>
                    <strong>{p.displayName}</strong>
                    <small>
                      {positionLabels[p.position]} · {money(p.priceFen)}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
          </section>
          <section className="bk-panel">
            <div className="bk-section-head">
              <h2 className="bk-number-title">
                <span>03</span>安排赛程
              </h2>
              {scope !== 'SINGLE' && (
                <button
                  type="button"
                  className="bk-button bk-outline bk-small"
                  onClick={() => setSlots((rows) => [...rows, initialSlot(rows.length)])}
                >
                  <Plus size={16} />
                  添加场次
                </button>
              )}
            </div>
            <p className="bk-muted">
              时间均为北京时间。条件场次先记意向，晋级后再确认，不预先占档。
            </p>
            {(data.matches ?? []).filter(
              (m) => m.eventId === eventId && (m.homeTeamId === teamId || m.awayTeamId === teamId),
            ).length > 0 && (
              <div className="bk-match-picker">
                <label>
                  从正式赛程添加
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      const m = data.matches.find((m) => m.id === e.target.value);
                      if (!m) return;
                      const slot: Slot = {
                        key: commandId(),
                        label: m.label,
                        conditional: false,
                        conditionText: '',
                        reportAt: inputTime(
                          new Date(Date.parse(m.startAt) - 30 * 60000).toISOString(),
                        ),
                        startAt: inputTime(m.startAt),
                        endAt: inputTime(m.endAt),
                        venue: m.venue,
                        matchId: m.id,
                      };
                      setSlots((rows) =>
                        scope === 'SINGLE'
                          ? [slot]
                          : [...rows.filter((s) => s.matchId !== m.id), slot],
                      );
                      e.target.value = '';
                    }}
                  >
                    <option value="">选择本队正式比赛</option>
                    {data.matches
                      .filter(
                        (m) =>
                          m.eventId === eventId &&
                          (m.homeTeamId === teamId || m.awayTeamId === teamId),
                      )
                      .map((m) => (
                        <option value={m.id} key={m.id}>
                          {m.label} · {localTime(m.startAt)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            )}
            <div className="bk-slot-list">
              {slots.map((s, i) => (
                <div className="bk-slot-editor" key={s.key}>
                  <div className="bk-slot-heading">
                    <strong>场次 {String(i + 1).padStart(2, '0')}</strong>
                    <div>
                      {scope !== 'SINGLE' && (
                        <label className="bk-inline-check">
                          <input
                            type="checkbox"
                            checked={s.conditional}
                            onChange={(e) =>
                              updateSlot(s.key, {
                                conditional: e.target.checked,
                                matchId: undefined,
                              })
                            }
                          />
                          待晋级 / 条件场次
                        </label>
                      )}
                      {slots.length > 1 && (
                        <button
                          type="button"
                          className="bk-icon-button"
                          aria-label={`删除场次${i + 1}`}
                          onClick={() => setSlots((rows) => rows.filter((x) => x.key !== s.key))}
                        >
                          <X size={17} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="bk-form-grid">
                    <label>
                      场次名称
                      <input
                        required
                        value={s.label}
                        maxLength={80}
                        onChange={(e) => updateSlot(s.key, { label: e.target.value })}
                      />
                    </label>
                    <label>
                      比赛地点
                      <input
                        required
                        placeholder="球场名称与具体地点"
                        maxLength={120}
                        value={s.venue}
                        onChange={(e) =>
                          updateSlot(s.key, { venue: e.target.value, matchId: undefined })
                        }
                      />
                    </label>
                    {s.conditional ? (
                      <>
                        <label className="bk-span-2">
                          触发条件
                          <input
                            required
                            maxLength={120}
                            value={s.conditionText}
                            onChange={(e) => updateSlot(s.key, { conditionText: e.target.value })}
                          />
                        </label>
                        <small className="bk-span-2 bk-condition-tip">
                          本场仅为意向，不占档、不计入当前确定报价。
                        </small>
                      </>
                    ) : (
                      <>
                        <label>
                          报到时间
                          <input
                            required
                            type="datetime-local"
                            value={s.reportAt}
                            onChange={(e) =>
                              updateSlot(s.key, { reportAt: e.target.value, matchId: undefined })
                            }
                          />
                        </label>
                        <label>
                          开赛时间
                          <input
                            required
                            type="datetime-local"
                            value={s.startAt}
                            onChange={(e) =>
                              updateSlot(s.key, { startAt: e.target.value, matchId: undefined })
                            }
                          />
                        </label>
                        <label>
                          预计结束
                          <input
                            required
                            type="datetime-local"
                            value={s.endAt}
                            onChange={(e) =>
                              updateSlot(s.key, { endAt: e.target.value, matchId: undefined })
                            }
                          />
                        </label>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="bk-panel bk-rules">
            <h2>预约前，把规则说清楚</h2>
            <Notice tone="warning">
              资格仅为双方声明，仍需主办方核验。本预约不会自动把球员加入赛事报名名单。
            </Notice>
            <p>
              球员独立选择是否接单。更改时间或地点需要双方确认；取消、拒绝或释放按场记录。整届预约只覆盖明确的场次与条件。
            </p>
            <p>
              服务以约定的到场参赛为准，不承诺得分、胜负或固定上场时间。当前不提供付费档期保留。
            </p>
            <label>
              <input
                type="checkbox"
                checked={eligibility}
                onChange={(e) => setEligibility(e.target.checked)}
              />
              我已核对赛事外援、报名截止、代表队及保险要求，并确认所选球员符合参赛条件
            </label>
            <label>
              <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} />
              我已阅读预约、变更与逐场取消规则，并知悉当前不发生线上资金交易
            </label>
          </section>
        </div>
        <aside className="bk-panel bk-checkout-aside">
          <span className="bk-eyebrow">RESERVATION SUMMARY</span>
          <h2>费用明细</h2>
          <div className="bk-summary-count">
            <strong>{chosen.length}</strong>
            <span>位球员</span>
            <strong>{fixed.length}</strong>
            <span>场已定赛程</span>
          </div>
          <dl className="bk-fee-list">
            <div>
              <dt>球员参赛服务费</dt>
              <dd>{money(services)}</dd>
            </div>
            <div>
              <dt>平台服务费 · {quoteData.settings.feeBps / 100}%</dt>
              <dd>{money(platform)}</dd>
            </div>
            <div>
              <dt>交通费</dt>
              <dd>{money(travel)}</dd>
            </div>
            <div>
              <dt>食宿费</dt>
              <dd>{money(accommodation)}</dd>
            </div>
          </dl>
          <div className="bk-total">
            <span>确定场次报价</span>
            <strong>{money(total)}</strong>
          </div>
          {conditional.length > 0 && (
            <div className="bk-conditional-summary">
              <span>另有 {conditional.length} 场条件意向</span>
              <strong>预计 {money(conditionalTotal)}</strong>
              <small>不计入上方金额，触发后重新确认</small>
            </div>
          )}
          <Notice tone="warning">
            线上支付与分账尚未接通。提交仅创建预约记录，费用为报价，实收为0。
          </Notice>
          {(validation || action.error) && (
            <p className="bk-error" role="alert">
              {validation || action.error}
            </p>
          )}
          {action.error && (
            <button
              type="button"
              className="bk-button bk-outline"
              disabled={action.busy}
              onClick={() => {
                void action.run(async () => {
                  const fresh = await repository.workspace();
                  setQuoteData(fresh);
                  setRules(false);
                  requestId.current = commandId();
                }, '最新报价已读取，请重新核对并勾选预约规则。');
              }}
            >
              重新读取最新报价
            </button>
          )}
          {action.success && (
            <p role="status" className="bk-muted">
              {action.success}
            </p>
          )}
          <button
            className="bk-button bk-primary"
            type="submit"
            disabled={action.busy || !chosen.length}
          >
            {action.busy ? '正在提交…' : '提交预约，等待球员确认'}
            <ArrowRight size={17} />
          </button>
          <small>服务费仅以参赛费计算；最终报价由服务器核算并保存费率快照。</small>
        </aside>
      </form>
    </>
  );
}
function Orders({ data, reload }: { data: BookingWorkspaceData; reload: () => void }) {
  const [filter, setFilter] = useState('ALL');
  const orders = data.orders.filter(
    (o) =>
      filter === 'ALL' ||
      (filter === 'INCOMING' && o.appearances.some((a) => a.playerUserId === data.viewerUserId)) ||
      (filter === 'OUTGOING' && o.buyerUserId === data.viewerUserId) ||
      o.status === filter,
  );
  return (
    <>
      <Heading
        eyebrow="MY RESERVATIONS"
        title="每场约定，都有进度"
        action={
          <button className="bk-button bk-outline" type="button" onClick={reload}>
            <RefreshCw size={16} />
            刷新预约
          </button>
        }
      >
        在一个总预约里管理多人、多场合作。费用、变更与履约按场独立记录。
        <span />
      </Heading>
      <p className="bk-muted bk-refresh-hint">
        主动刷新可获取新预约与最新处理进度。当前尚未接通短信或微信实时通知。
      </p>
      <div className="bk-order-topline">
        <div className="bk-chips">
          {[
            ['ALL', '全部预约'],
            ['OUTGOING', '我发出的'],
            ['INCOMING', '我收到的'],
            ['COMPLETED', '已完成'],
            ['CANCELLED', '已取消'],
          ].map(([key, label]) => (
            <button
              key={key}
              aria-pressed={filter === key}
              className={filter === key ? 'active' : ''}
              onClick={() => setFilter(key!)}
            >
              {label}
            </button>
          ))}
        </div>
        <Link className="bk-button bk-primary bk-small" to="/players">
          <Plus size={16} />
          发起预约
        </Link>
      </div>
      {data.ordersHasMore && (
        <Notice>当前仅展示最近100份预约；更早的预约可通过原详情链接读取。</Notice>
      )}
      {orders.length ? (
        <div className="bk-orders-list">
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      ) : (
        <Empty title="这里还没有预约">
          <p>发出预约或收到球员邀请后，可在这里查看每场进度。</p>
          <Link className="bk-button bk-primary" to="/players">
            去找球员
            <ArrowRight size={16} />
          </Link>
        </Empty>
      )}
    </>
  );
}
function OrderCard({ order: o }: { order: BookingOrderData }) {
  const completed = o.appearances.filter((a) => a.status === 'COMPLETED').length,
    conditional = o.appearances.filter((a) => a.status === 'CONDITIONAL').length;
  const next = o.appearances
    .filter((a) => ['REQUESTED', 'ACCEPTED', 'ARRIVED'].includes(a.status))
    .sort((a, b) => (a.startAt ?? '').localeCompare(b.startAt ?? ''))[0];
  return (
    <article className="bk-panel bk-order-card">
      <div className="bk-order-card-top">
        <span className="bk-order-scope">
          <CalendarDays size={15} />
          {scopeLabels[o.scope]}
        </span>
        <Badge state={o.status} />
      </div>
      <Link to={`/player-bookings/${encodeURIComponent(o.id)}`} className="bk-order-title">
        <h2>{o.eventName}</h2>
        <ChevronRight size={22} />
      </Link>
      <p className="bk-muted">
        {o.teamName} · {Array.from(new Set(o.appearances.map((a) => a.playerName))).join('、')}
      </p>
      <div className="bk-order-progress">
        <span>
          已完成 <strong>{completed}</strong> / {o.appearances.length - conditional} 场服务
        </span>
        {conditional > 0 && <span>{conditional} 场条件意向</span>}
      </div>
      <div className="bk-progress-track">
        <span
          style={{
            width: `${(completed / Math.max(1, o.appearances.length - conditional)) * 100}%`,
          }}
        />
      </div>
      <div className="bk-order-card-bottom">
        <div>
          <small>下一场</small>
          <strong>{next ? `${shortDate(next.startAt)} · ${next.label}` : '暂无待到场场次'}</strong>
        </div>
        <div className="bk-order-money">
          <small>确定赛程报价 / 未收款</small>
          <strong>{money(o.totals.confirmedTotalFen)}</strong>
        </div>
      </div>
      <Link className="bk-text-link" to={`/player-bookings/${encodeURIComponent(o.id)}`}>
        查看总预约与逐场详情
        <ArrowRight size={16} />
      </Link>
    </article>
  );
}
type CommandModal = {
  order: BookingOrderData;
  appearance: BookingAppearanceData;
  type: BookingCommandInput['type'];
  id: string;
};
const commands: {
  type: BookingCommandInput['type'];
  label: string;
  cap: keyof BookingAppearanceData['capabilities'];
  tone?: string;
}[] = [
  { type: 'ACCEPT', label: '接受本场预约', cap: 'canAccept', tone: 'primary' },
  { type: 'DECLINE', label: '拒绝本场', cap: 'canDecline' },
  { type: 'ACTIVATE', label: '条件已触发，确认赛程', cap: 'canActivate', tone: 'primary' },
  { type: 'ARRIVE', label: '记录本人到场', cap: 'canArrive', tone: 'primary' },
  { type: 'COMPLETE', label: '确认本场完成', cap: 'canComplete', tone: 'primary' },
  { type: 'PROPOSE_CHANGE', label: '申请改期 / 换地点', cap: 'canProposeChange' },
  { type: 'ACCEPT_CHANGE', label: '同意变更', cap: 'canAcceptChange', tone: 'primary' },
  { type: 'REJECT_CHANGE', label: '拒绝变更', cap: 'canRejectChange' },
  { type: 'CANCEL', label: '取消本场', cap: 'canCancel' },
  { type: 'DISPUTE', label: '发起争议', cap: 'canDispute' },
  { type: 'RESOLVE_DISPUTE', label: '处理争议', cap: 'canResolveDispute', tone: 'primary' },
];
export function OrderDetails({
  data,
  id,
  repository,
  reload,
  demo,
}: {
  data: BookingWorkspaceData;
  id: string;
  repository: BookingRepository;
  reload: () => void;
  demo: boolean;
}) {
  const read = useCallback(() => repository.get(id), [repository, id, data.viewerUserId]);
  const orderResource = useResource(read);
  const o = orderResource.data,
    [pending, setPending] = useState<CommandModal | null>(null);
  useEffect(() => {
    setPending(null);
  }, [data.viewerUserId, id]);
  if (orderResource.loading || orderResource.error)
    return (
      <ResourceState
        loading={orderResource.loading}
        error={orderResource.error}
        reload={orderResource.reload}
      />
    );
  if (!o)
    return (
      <Empty title="预约不存在或当前无权查看">
        <p>请重新读取列表，或核对当前账号与球队授权。</p>
        <Link to="/player-bookings">返回我的预约</Link>
      </Empty>
    );
  const complete = o.appearances.filter((a) => a.status === 'COMPLETED').length,
    conditional = o.appearances.filter((a) => a.status === 'CONDITIONAL').length;
  return (
    <>
      <Link className="bk-back" to="/player-bookings">
        <ArrowLeft size={17} />
        返回我的预约
      </Link>
      <Heading
        eyebrow="RESERVATION DETAILS"
        title={o.eventName}
        action={<Badge state={o.status} />}
      >
        {o.teamName} · {scopeLabels[o.scope]} ·{' '}
        {Array.from(new Set(o.appearances.map((a) => a.playerName))).join('、')}
      </Heading>
      <Notice tone="warning">{o.eligibilityNotice}</Notice>
      <div className="bk-order-detail-layout">
        <div>
          <div className="bk-series-summary">
            <div>
              <span>已完成</span>
              <strong>
                {complete}
                <small> / {o.appearances.length - conditional}场</small>
              </strong>
            </div>
            <div>
              <span>条件意向</span>
              <strong>
                {conditional}
                <small>场 · 不占档</small>
              </strong>
            </div>
            <div>
              <span>合作服务费率</span>
              <strong>
                {o.feeBps / 100}
                <small>% · 已保存快照</small>
              </strong>
            </div>
          </div>
          <h2 className="bk-section-title">
            逐场履约 <small>每位球员、每场比赛独立记录</small>
          </h2>
          <div className="bk-appearance-list">
            {o.appearances.map((a, i) => (
              <article
                className={`bk-panel bk-appearance bk-appearance-${a.status.toLowerCase()}`}
                key={a.id}
              >
                <div className="bk-appearance-head">
                  <span className="bk-appearance-index">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{a.label}</h3>
                    <p>
                      {a.playerName} · {positionLabels[a.position]}
                    </p>
                  </div>
                  <Badge state={a.status} />
                </div>
                <div className="bk-appearance-info">
                  <span>
                    <CalendarDays size={16} />
                    {localTime(a.startAt, true)}
                  </span>
                  <span>
                    <Clock3 size={16} />
                    {a.reportAt
                      ? `报到 ${localTime(a.reportAt)} · 预计结束 ${localTime(a.endAt)}`
                      : '触发后双方确认具体时段'}
                  </span>
                  <span>
                    <MapPin size={16} />
                    {a.venue}
                  </span>
                </div>
                {a.scheduleChanged && (
                  <Notice tone="warning">
                    关联正式赛程已变更。请先核对并申请修改预约，当前不能接单、到场或确认完成。
                  </Notice>
                )}
                {a.conditionText && (
                  <p className="bk-condition-tip">
                    触发条件：{a.conditionText}
                    {a.status === 'CONDITIONAL' ? '；当前不占档。' : ''}
                  </p>
                )}
                {a.changeRequest && (
                  <div className="bk-change-box">
                    <strong>有一项变更待对方确认</strong>
                    <p>
                      {localTime(a.changeRequest.startAt, true)} · {a.changeRequest.venue}
                    </p>
                    <p>
                      报到 {localTime(a.changeRequest.reportAt)} / 结束{' '}
                      {localTime(a.changeRequest.endAt)}
                    </p>
                    <small>原因：{a.changeRequest.reason}。同意前仍保留原预约。</small>
                  </div>
                )}
                {a.cancellationReason && (
                  <p className="bk-muted">处理原因：{a.cancellationReason}</p>
                )}
                <div className="bk-appearance-cost">
                  <span>
                    参赛 {money(a.serviceFen)} ＋ 平台 {money(a.platformFeeFen)} ＋ 交通{' '}
                    {money(a.travelFen)} ＋ 食宿 {money(a.accommodationFen)}
                  </span>
                  <strong>
                    {money(a.totalFen)}
                    <small>报价 · 未付款</small>
                  </strong>
                </div>
                <div className="bk-appearance-actions">
                  {commands
                    .filter((c) => a.capabilities[c.cap])
                    .map((c) => (
                      <button
                        key={c.type}
                        type="button"
                        className={`bk-button bk-small ${c.tone === 'primary' ? 'bk-primary' : 'bk-outline'}`}
                        onClick={() =>
                          setPending({ order: o, appearance: a, type: c.type, id: commandId() })
                        }
                      >
                        {c.label}
                      </button>
                    ))}
                </div>
                {a.status === 'ACCEPTED' && !a.capabilities.canArrive && (
                  <p className="bk-muted bk-action-hint">
                    到场操作仅向球员本人开放，并受报到与结束时间限制。
                  </p>
                )}
              </article>
            ))}
          </div>
        </div>
        <aside className="bk-panel bk-order-aside">
          <h2>费用与资金进度</h2>
          <dl className="bk-fee-list">
            <div>
              <dt>确定场次参赛费</dt>
              <dd>{money(o.totals.confirmedServiceFen)}</dd>
            </div>
            <div>
              <dt>平台服务费</dt>
              <dd>{money(o.totals.confirmedPlatformFeeFen)}</dd>
            </div>
            <div>
              <dt>交通费</dt>
              <dd>{money(o.totals.confirmedTravelFen)}</dd>
            </div>
            <div>
              <dt>食宿费</dt>
              <dd>{money(o.totals.confirmedAccommodationFen)}</dd>
            </div>
          </dl>
          <div className="bk-total">
            <span>确定赛程报价</span>
            <strong>{money(o.totals.confirmedTotalFen)}</strong>
          </div>
          {conditional > 0 && (
            <div className="bk-conditional-summary">
              <span>条件场次预计</span>
              <strong>{money(o.totals.conditionalTotalFen)}</strong>
              <small>不计入确定报价，不代表球员已经接单</small>
            </div>
          )}
          <dl className="bk-money-facts">
            <div>
              <dt>线上已收</dt>
              <dd>{money(o.totals.paidFen)}</dd>
            </div>
            <div>
              <dt>已结算</dt>
              <dd>{money(o.totals.settledFen)}</dd>
            </div>
            <div>
              <dt>已退款</dt>
              <dd>{money(o.totals.refundedFen)}</dd>
            </div>
          </dl>
          <Notice tone="warning">{data.paymentNotice}</Notice>
          <button className="bk-button bk-disabled" disabled>
            线上支付暂未开放
          </button>
          <small>
            订单编号 {o.id}
            <br />
            创建于 {localTime(o.createdAt, true)}
          </small>
          {demo && (
            <p className="bk-muted">可切换“预约球员”身份，体验接单与变更确认。仅为演示记录。</p>
          )}
        </aside>
      </div>
      {pending && (
        <AppearanceCommand
          modal={pending}
          repository={repository}
          onClose={() => setPending(null)}
          onDone={() => {
            setPending(null);
            orderResource.reload();
            reload();
          }}
        />
      )}
    </>
  );
}
function AppearanceCommand({
  modal,
  repository,
  onClose,
  onDone,
}: {
  modal: CommandModal;
  repository: BookingRepository;
  onClose: () => void;
  onDone: () => void;
}) {
  const a = modal.appearance,
    type = modal.type,
    title = commands.find((c) => c.type === type)!.label;
  const schedule = type === 'ACTIVATE' || type === 'PROPOSE_CHANGE';
  const reasonRequired = [
    'CANCEL',
    'DECLINE',
    'DISPUTE',
    'PROPOSE_CHANGE',
    'REJECT_CHANGE',
    'RESOLVE_DISPUTE',
  ].includes(type);
  const needsEligibility = ['ACCEPT', 'ACTIVATE', 'ACCEPT_CHANGE'].includes(type);
  const base = initialSlot();
  const [reportAt, setReportAt] = useState(a.reportAt ? inputTime(a.reportAt) : base.reportAt),
    [startAt, setStartAt] = useState(a.startAt ? inputTime(a.startAt) : base.startAt),
    [endAt, setEndAt] = useState(a.endAt ? inputTime(a.endAt) : base.endAt),
    [venue, setVenue] = useState(a.venue),
    [reason, setReason] = useState(''),
    [eligible, setEligible] = useState(false),
    [validation, setValidation] = useState(''),
    [resolution, setResolution] = useState<'RESUME' | 'CANCEL' | 'COMPLETE'>('RESUME');
  const action = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    setValidation('');
    if (reasonRequired && reason.trim().length < 2) {
      setValidation('请填写至少2个字符的处理原因。');
      return;
    }
    if (
      schedule &&
      (!reportAt || !startAt || !endAt || reportAt > startAt || startAt >= endAt || !venue.trim())
    ) {
      setValidation('请填写有效时间与地点。');
      return;
    }
    if (needsEligibility && !eligible) {
      setValidation('请确认本场合作与资格声明。');
      return;
    }
    await action.run(async () => {
      await repository.command(modal.order.id, {
        commandId: modal.id,
        expectedVersion: a.version,
        appearanceId: a.id,
        type,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(schedule
          ? {
              reportAt: isoTime(reportAt),
              startAt: isoTime(startAt),
              endAt: isoTime(endAt),
              venue: venue.trim(),
            }
          : {}),
        ...(needsEligibility ? { eligibilityConfirmed: true as const } : {}),
        ...(type === 'RESOLVE_DISPUTE' ? { resolution } : {}),
      });
      onDone();
    });
  }
  return (
    <Modal title={title} busy={action.busy} onClose={onClose}>
      <form className="bk-dialog-form" onSubmit={(e) => void submit(e)}>
        <p>
          <strong>
            {a.label} · {a.playerName}
          </strong>
        </p>
        <p>
          {localTime(a.startAt, true)} · {a.venue}
        </p>
        {schedule && (
          <div className="bk-form-grid">
            <label>
              报到时间
              <input
                type="datetime-local"
                required
                value={reportAt}
                onChange={(e) => setReportAt(e.target.value)}
              />
            </label>
            <label>
              开赛时间
              <input
                type="datetime-local"
                required
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </label>
            <label>
              预计结束
              <input
                type="datetime-local"
                required
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </label>
            <label>
              比赛地点
              <input
                required
                value={venue}
                maxLength={120}
                onChange={(e) => setVenue(e.target.value)}
              />
            </label>
          </div>
        )}
        {needsEligibility && (
          <label className="bk-inline-check">
            <input
              type="checkbox"
              checked={eligible}
              onChange={(e) => setEligible(e.target.checked)}
            />
            我已核对本场合作信息与参赛要求，知悉资格仍需主办方核验
          </label>
        )}
        {type === 'ACCEPT_CHANGE' && a.changeRequest && (
          <Notice>
            同意后改为 {localTime(a.changeRequest.startAt, true)}，地点：{a.changeRequest.venue}。
          </Notice>
        )}
        {type === 'RESOLVE_DISPUTE' && (
          <label>
            处理结果
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as typeof resolution)}
            >
              <option value="RESUME">恢复至已接单，继续履约</option>
              <option value="CANCEL">取消本场</option>
              <option value="COMPLETE">根据核实结果标记完成</option>
            </select>
          </label>
        )}
        {reasonRequired && (
          <label>
            处理原因
            <textarea
              required
              minLength={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请写明具体情况，留作双方核对依据"
            />
          </label>
        )}
        <Notice>
          {type === 'ACTIVATE'
            ? '激活后重新向球员发出本场预约，球员确认前不代表已接单。'
            : type === 'PROPOSE_CHANGE'
              ? '提交后等待对方确认。对方同意前保留原约定与档期。'
              : type === 'CANCEL'
                ? '只取消这一位球员的这一场服务；其他场次不受影响。当前没有线上付款，不会产生实际退款。'
                : type === 'ARRIVE'
                  ? '记录的是本人到场声明，不是GPS或扫码核验；领队仍需确认本场完成。'
                  : type === 'COMPLETE'
                    ? '确认本场服务完成，仅更新履约记录；不会自动收款或分账。'
                    : type === 'DISPUTE'
                      ? '本场会标记为争议处理中，并留存原因。当前没有真实结算，后续由独立平台操作员联系双方处理。'
                      : '请核对场次后确认。此次操作会保留记录，不改变真实支付状态。'}
        </Notice>
        {(validation || action.error) && (
          <p role="alert" className="bk-error">
            {validation || action.error}
          </p>
        )}
        <div className="bk-dialog-actions">
          <button
            type="button"
            className="bk-button bk-outline"
            disabled={action.busy}
            onClick={onClose}
          >
            返回
          </button>
          <button className="bk-button bk-primary" disabled={action.busy} type="submit">
            {action.busy ? '正在处理…' : '确认操作'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function PlayerCenter({
  data,
  repository,
  demo,
  reload,
}: {
  data: BookingWorkspaceData;
  repository: BookingRepository;
  demo: boolean;
  reload: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const profile = data.ownProfile;
  const incoming = data.orders.filter((o) =>
    o.appearances.some((a) => a.playerUserId === data.viewerUserId),
  );
  const received = incoming
    .flatMap((o) => o.appearances)
    .filter((a) => a.playerUserId === data.viewerUserId);
  return (
    <>
      <Heading
        eyebrow="PLAYER CENTER"
        title="让下一场比赛，找到你"
        action={
          <button className="bk-button bk-primary" onClick={() => setEditing(true)}>
            <Plus size={17} />
            {profile ? '编辑入驻资料' : '申请成为预约球员'}
          </button>
        }
      >
        维护真实资料与可约时间，自主决定接哪些比赛。
      </Heading>
      {profile ? (
        <section className="bk-panel bk-center-profile">
          <Avatar player={profile} demo={demo} />
          <div>
            <Badge state={profile.status} />
            <h2>{profile.displayName}</h2>
            <p>
              {positionLabels[profile.position]} · {profile.heightCm}cm · {profile.city}
            </p>
            <strong className="bk-price">
              {money(profile.priceFen)}
              <small> / 场或约定时段</small>
            </strong>
            {profile.reviewReason && <p className="bk-muted">审核意见：{profile.reviewReason}</p>}
          </div>
          <div className="bk-center-profile-note">
            <ShieldCheck />
            <strong>修改资料后重新审核</strong>
            <p>公开广场仅展示审核通过的入驻资料；审核不替代实名、保险或赛事资格核验。</p>
          </div>
        </section>
      ) : (
        <section className="bk-join-banner">
          <div>
            <span className="bk-eyebrow">YOUR GAME, YOUR CHOICE</span>
            <h2>你有实力，也有自己的档期。</h2>
            <p>填写位置、服务报价和可约时间，审核后进入球员广场。接单前完整查看比赛与球队信息。</p>
            <button className="bk-button bk-primary" onClick={() => setEditing(true)}>
              填写我的球员资料
              <ArrowRight size={17} />
            </button>
          </div>
          <span className="bk-join-number" aria-hidden="true">
            07
          </span>
        </section>
      )}
      <div className="bk-kpis">
        <div>
          <span>待确认场次</span>
          <strong>{received.filter((a) => a.status === 'REQUESTED').length}</strong>
        </div>
        <div>
          <span>已接受场次</span>
          <strong>{received.filter((a) => a.status === 'ACCEPTED').length}</strong>
        </div>
        <div>
          <span>已完成场次</span>
          <strong>{received.filter((a) => a.status === 'COMPLETED').length}</strong>
        </div>
        <div>
          <span>线上已结算</span>
          <strong>{money(0)}</strong>
          <small>支付及分账未接通</small>
        </div>
      </div>
      <div className="bk-section-head">
        <h2>收到的系列预约</h2>
        <button
          className="bk-button bk-outline bk-small"
          type="button"
          disabled={editing}
          onClick={reload}
        >
          <RefreshCw size={15} />
          刷新预约
        </button>
        <Link className="bk-text-link" to="/player-bookings">
          查看全部
          <ChevronRight size={16} />
        </Link>
      </div>
      <p className="bk-muted bk-refresh-hint">
        页面不会自动轮询。新预约请点击刷新查看；当前尚未接通短信或微信实时通知。
      </p>
      {incoming.length ? (
        <div className="bk-orders-list">
          {incoming.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      ) : (
        <Empty title="暂时没有收到预约">
          <p>资料审核通过后，领队可以向你发起预约。你始终可以接受或拒绝。</p>
        </Empty>
      )}
      <Notice>
        到场记录由球员本人提交，服务完成由球队领队确认。仅公布你愿意展示的球员资料，不公开身份证、联系方式或保单。
      </Notice>
      {editing && (
        <ProfileForm
          profile={profile}
          repository={repository}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
    </>
  );
}
function parseFen(value: string) {
  if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value))
    throw new Error('费用应为非负金额，最多保留两位小数。');
  const [major, minor = ''] = value.split('.');
  return Number(major) * 100 + Number(minor.padEnd(2, '0'));
}
function ProfileForm({
  profile,
  repository,
  onClose,
  onDone,
}: {
  profile: BookingPlayerData | null;
  repository: BookingRepository;
  onClose: () => void;
  onDone: () => void;
}) {
  const base = initialSlot();
  const [name, setName] = useState(profile?.displayName ?? ''),
    [position, setPosition] = useState<BookingPlayerData['position']>(profile?.position ?? 'PG'),
    [height, setHeight] = useState(String(profile?.heightCm ?? 180)),
    [city, setCity] = useState(profile?.city ?? '高州'),
    [bio, setBio] = useState(profile?.bio ?? ''),
    [price, setPrice] = useState(String((profile?.priceFen ?? 30000) / 100)),
    [travel, setTravel] = useState(String((profile?.travelFen ?? 0) / 100)),
    [accommodation, setAccommodation] = useState(String((profile?.accommodationFen ?? 0) / 100)),
    [adult, setAdult] = useState(false),
    [windows, setWindows] = useState(
      profile?.availability.map((w) => ({
        start: inputTime(w.startAt),
        end: inputTime(w.endAt),
      })) ?? [{ start: base.reportAt, end: base.endAt }],
    ),
    [validation, setValidation] = useState('');
  const action = useAction(),
    id = useRef(commandId());
  async function submit(e: FormEvent) {
    e.preventDefault();
    setValidation('');
    if (!adult) {
      setValidation('本次仅开放年满18周岁者申请，请确认。');
      return;
    }
    if (!windows.length || windows.some((w) => !w.start || !w.end || w.start >= w.end)) {
      setValidation('请填写有效的可约时间窗口。');
      return;
    }
    let input: BookingProfileInput;
    try {
      input = {
        commandId: id.current,
        expectedVersion: profile?.version ?? 0,
        displayName: name.trim(),
        position,
        heightCm: Number(height),
        city: city.trim(),
        bio: bio.trim(),
        priceFen: parseFen(price),
        travelFen: parseFen(travel),
        accommodationFen: parseFen(accommodation),
        availability: windows.map((w) => ({ startAt: isoTime(w.start), endAt: isoTime(w.end) })),
        adultConfirmed: true,
      };
    } catch (error) {
      setValidation(error instanceof Error ? error.message : '请检查金额');
      return;
    }
    await action.run(async () => {
      await repository.saveProfile(input);
      onDone();
    });
  }
  return (
    <Modal
      title={profile ? '更新球员入驻资料' : '申请成为预约球员'}
      busy={action.busy}
      onClose={onClose}
    >
      <form className="bk-dialog-form" onSubmit={(e) => void submit(e)}>
        <Notice>
          资料提交后需要平台审核。请仅填写本人信息，修改审核通过的资料会重新进入审核。
        </Notice>
        <div className="bk-form-grid">
          <label>
            公开球员名称
            <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            主打位置
            <select
              value={position}
              onChange={(e) => setPosition(e.target.value as BookingPlayerData['position'])}
            >
              {Object.entries(positionLabels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            身高（cm）
            <input
              type="number"
              min={120}
              max={250}
              required
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>
          <label>
            服务地区
            <input
              required
              maxLength={80}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="如：高州 · 石鼓"
            />
          </label>
          <label>
            参赛报价（元 / 场或时段）
            <input
              required
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label>
            每场交通报价（元）
            <input
              required
              inputMode="decimal"
              value={travel}
              onChange={(e) => setTravel(e.target.value)}
            />
          </label>
          <label>
            每场食宿报价（元）
            <input
              required
              inputMode="decimal"
              value={accommodation}
              onChange={(e) => setAccommodation(e.target.value)}
            />
          </label>
          <label className="bk-span-2">
            个人特点与服务说明
            <textarea
              required
              minLength={2}
              maxLength={500}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="主打特点、愿意承担的角色、可服务范围及约定说明"
            />
          </label>
        </div>
        <div className="bk-section-head">
          <h3>可约档期（北京时间）</h3>
          <button
            type="button"
            className="bk-button bk-outline bk-small"
            disabled={windows.length >= 12}
            onClick={() =>
              setWindows((rows) => [...rows, { start: base.reportAt, end: base.endAt }])
            }
          >
            <Plus size={14} />
            添加窗口
          </button>
        </div>
        {windows.map((w, i) => (
          <div className="bk-profile-window" key={i}>
            <label>
              可约开始 {i + 1}
              <input
                required
                type="datetime-local"
                value={w.start}
                onChange={(e) =>
                  setWindows((rows) =>
                    rows.map((v, j) => (j === i ? { ...v, start: e.target.value } : v)),
                  )
                }
              />
            </label>
            <label>
              可约结束 {i + 1}
              <input
                required
                type="datetime-local"
                value={w.end}
                onChange={(e) =>
                  setWindows((rows) =>
                    rows.map((v, j) => (j === i ? { ...v, end: e.target.value } : v)),
                  )
                }
              />
            </label>
            {windows.length > 1 && (
              <button
                type="button"
                className="bk-icon-button"
                aria-label={`删除时间窗口${i + 1}`}
                onClick={() => setWindows((rows) => rows.filter((_, j) => j !== i))}
              >
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        <label className="bk-inline-check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          本人已年满18周岁，资料与可约时间真实，愿意自主接单
        </label>
        {(validation || action.error) && (
          <p className="bk-error" role="alert">
            {validation || action.error}
          </p>
        )}
        <div className="bk-dialog-actions">
          <button
            type="button"
            className="bk-button bk-outline"
            disabled={action.busy}
            onClick={onClose}
          >
            返回
          </button>
          <button type="submit" className="bk-button bk-primary" disabled={action.busy}>
            {action.busy ? '正在提交…' : '提交资料，等待审核'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Operations({
  data,
  repository,
  reload,
}: {
  data: BookingWorkspaceData;
  repository: BookingRepository;
  reload: () => void;
}) {
  const [review, setReview] = useState<{
      profile: BookingPlayerData;
      status: 'APPROVED' | 'REJECTED' | 'DISABLED';
      id: string;
    } | null>(null),
    [reason, setReason] = useState(''),
    [rate, setRate] = useState(String(data.settings.feeBps / 100)),
    [feeConfirm, setFeeConfirm] = useState(false),
    [validation, setValidation] = useState('');
  const action = useAction(),
    feeId = useRef(commandId());
  if (!data.isPlatformOperator)
    return (
      <Empty title="当前没有平台运营权限">
        <p>机构管理员与球队领队不自动拥有球员审核和平台费率配置权限。</p>
        <Link to="/players">返回球员广场</Link>
      </Empty>
    );
  async function setFee(e: FormEvent) {
    e.preventDefault();
    setValidation('');
    const basis = Number(rate) * 100;
    if (!Number.isSafeInteger(basis) || basis < 0 || basis > 3000) {
      setValidation('请输入0%至30%的费率，最多两位小数。');
      return;
    }
    if (!feeConfirm) {
      setValidation('请确认新费率只影响后续新订单。');
      return;
    }
    await action.run(async () => {
      await repository.updateFee(data.settings.version, basis, feeId.current);
      feeId.current = commandId();
      setFeeConfirm(false);
      reload();
    }, '新费率已保存');
  }
  return (
    <>
      <Heading eyebrow="PLATFORM OPERATIONS" title="把服务做好，也把账看清楚">
        入驻审核、报价服务费和履约统计。报价、实收与结算分别展示。
      </Heading>
      <div className="bk-kpis">
        <div>
          <span>可见合作预约</span>
          <strong>{data.statistics.orders}</strong>
        </div>
        <div>
          <span>已完成场次</span>
          <strong>{data.statistics.completedAppearances}</strong>
        </div>
        <div>
          <span>确定赛程服务费报价</span>
          <strong>{money(data.statistics.quotedPlatformFeeFen)}</strong>
          <small>报价，尚未收款</small>
        </div>
        <div>
          <span>平台已收服务费</span>
          <strong>{money(data.statistics.collectedPlatformFeeFen)}</strong>
          <small>支付未接通，不能算作利润</small>
        </div>
      </div>
      <div className="bk-ops-grid">
        <section className="bk-panel">
          <div className="bk-section-head">
            <h2>球员入驻审核</h2>
            <Badge>{data.reviewQueue.filter((p) => p.status === 'PENDING').length} 待审核</Badge>
          </div>
          <Notice>
            核对公开入驻资料与服务说明。审核通过不代表完成真实身份、保险或赛事资格验证；不得自审。
          </Notice>
          {data.reviewQueue.length ? (
            <div className="bk-review-list">
              {data.reviewQueue.map((p) => (
                <div className="bk-review-row" key={p.id}>
                  <div>
                    <strong>{p.displayName}</strong>
                    <Badge state={p.status} />
                    <p>
                      {positionLabels[p.position]} · {p.heightCm}cm · {p.city} · 参赛{' '}
                      {money(p.priceFen)}
                    </p>
                    <p>{p.bio}</p>
                    <small>
                      可约窗口：
                      {p.availability
                        .map((w) => `${localTime(w.startAt)} 至 ${localTime(w.endAt)}`)
                        .join('；')}
                    </small>
                  </div>
                  <div className="bk-review-actions">
                    {p.status !== 'APPROVED' && (
                      <button
                        className="bk-button bk-primary bk-small"
                        disabled={p.userId === data.viewerUserId}
                        onClick={() => {
                          setReason('已核对入驻资料与服务说明');
                          setReview({ profile: p, status: 'APPROVED', id: commandId() });
                        }}
                      >
                        审核通过
                      </button>
                    )}
                    {p.status === 'PENDING' && (
                      <button
                        className="bk-button bk-outline bk-small"
                        disabled={p.userId === data.viewerUserId}
                        onClick={() => {
                          setReason('');
                          setReview({ profile: p, status: 'REJECTED', id: commandId() });
                        }}
                      >
                        退回修改
                      </button>
                    )}
                    {p.status === 'APPROVED' && (
                      <button
                        className="bk-button bk-outline bk-small"
                        disabled={p.userId === data.viewerUserId}
                        onClick={() => {
                          setReason('');
                          setReview({ profile: p, status: 'DISABLED', id: commandId() });
                        }}
                      >
                        停用入驻
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="bk-muted">暂时没有待核对的入驻资料。</p>
          )}
        </section>
        <aside>
          <section className="bk-panel">
            <h2>平台服务费率</h2>
            <form className="bk-dialog-form" onSubmit={(e) => void setFee(e)}>
              <label>
                新订单费率（%）
                <input
                  type="number"
                  min={0}
                  max={30}
                  step="0.01"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  required
                />
              </label>
              <p className="bk-muted">
                仅以球员参赛服务费计算；交通与食宿不计提。历史订单保留原费率。
              </p>
              <label className="bk-inline-check">
                <input
                  type="checkbox"
                  checked={feeConfirm}
                  onChange={(e) => setFeeConfirm(e.target.checked)}
                />
                确认仅影响后续新订单
              </label>
              {(validation || action.error) && (
                <p role="alert" className="bk-error">
                  {validation || action.error}
                </p>
              )}
              <button className="bk-button bk-primary" disabled={action.busy} type="submit">
                {action.busy ? '正在保存…' : '保存新订单费率'}
              </button>
            </form>
          </section>
          <section className="bk-panel bk-trial">
            <span className="bk-eyebrow">TRIAL CHECKPOINT</span>
            <h2>首批30笔验证</h2>
            <strong>
              {Math.min(data.statistics.orders, 30)}
              <small> / 30笔预约记录</small>
            </strong>
            <div className="bk-progress-track">
              <span style={{ width: `${Math.min(100, (data.statistics.orders / 30) * 100)}%` }} />
            </div>
            <p>真实收款、获客成本、客服耗时与复购仍需单独验证。当前预约数量不等于付费成交数量。</p>
          </section>
        </aside>
      </div>
      <div className="bk-section-head">
        <h2>平台可见预约</h2>
        <button
          className="bk-button bk-outline bk-small"
          type="button"
          disabled={Boolean(review) || rate !== String(data.settings.feeBps / 100) || feeConfirm}
          onClick={reload}
        >
          <RefreshCw size={15} />
          刷新预约
        </button>
        <Link to="/player-bookings" className="bk-text-link">
          查看订单
          <ArrowRight size={16} />
        </Link>
      </div>
      <div className="bk-orders-list">
        {data.orders.map((o) => (
          <OrderCard key={o.id} order={o} />
        ))}
      </div>
      {review && (
        <Modal
          title={
            review.status === 'APPROVED'
              ? '确认审核通过'
              : review.status === 'REJECTED'
                ? '退回球员资料'
                : '停用球员入驻'
          }
          busy={action.busy}
          onClose={() => setReview(null)}
        >
          <form
            className="bk-dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reason.trim()) return;
              void action.run(async () => {
                await repository.reviewProfile(
                  review.profile.id,
                  review.profile.version,
                  review.status,
                  reason.trim(),
                  review.id,
                );
                setReview(null);
                reload();
              });
            }}
          >
            <p>
              {review.profile.displayName} · {positionLabels[review.profile.position]}
            </p>
            <label>
              审核原因
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Notice>此次操作仅更新入驻资料审核状态，并保留处理原因。</Notice>
            {action.error && (
              <p role="alert" className="bk-error">
                {action.error}
              </p>
            )}
            <div className="bk-dialog-actions">
              <button
                type="button"
                className="bk-button bk-outline"
                disabled={action.busy}
                onClick={() => setReview(null)}
              >
                返回
              </button>
              <button type="submit" className="bk-button bk-primary" disabled={action.busy}>
                确认审核
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
