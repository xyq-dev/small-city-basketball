const api = require('../../utils/api');
const ui = require('../../utils/ui');
const sponsorship = require('../../utils/sponsorship');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  VERSION = /^[a-z0-9][a-z0-9-]{0,63}$/,
  KEY = /^[A-Za-z0-9_-]{43}$/;
Component({
  properties: {
    regionId: { type: String, value: '' },
    catalogVersion: { type: String, value: '' },
    eventPublicId: { type: String, value: '' },
    visible: { type: Boolean, value: true },
  },
  data: { card: null, loading: false },
  lifetimes: {
    attached() {
      this._alive = true;
      this._pageVisible = true;
      this._reports = new Map();
      this._epoch = 0;
      this.configure();
    },
    detached() {
      this._alive = false;
      this.clear();
    },
  },
  pageLifetimes: {
    show() {
      this._pageVisible = true;
      if (this._alive) this.configure();
    },
    hide() {
      this._pageVisible = false;
      this.clear();
    },
  },
  observers: {
    'regionId,catalogVersion,eventPublicId,visible': function () {
      if (this._alive) this.configure();
    },
  },
  methods: {
    scope() {
      const p = this.properties;
      if (
        !p.visible ||
        !ID.test(p.regionId || '') ||
        !VERSION.test(p.catalogVersion || '') ||
        (p.eventPublicId && !KEY.test(p.eventPublicId))
      )
        return null;
      return {
        regionId: p.regionId.toLowerCase(),
        catalogVersion: p.catalogVersion,
        eventPublicId: p.eventPublicId || '',
      };
    },
    configure() {
      const scope = this.scope(),
        key = scope ? [scope.regionId, scope.catalogVersion, scope.eventPublicId].join(':') : '';
      if (key === this._scopeKey && this._timer && this._alive && this._pageVisible) {
        this.refresh();
        return;
      }
      this.clear();
      this._scope = scope;
      this._scopeKey = key;
      if (!scope || !this._alive || !this._pageVisible) return;
      this._timer = setInterval(() => this.refresh(), 15000);
      this.refresh();
    },
    clear() {
      this._epoch = (this._epoch || 0) + 1;
      this.stopObserver();
      this.stopExpiry();
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
      this._loadingEpoch = null;
      this.setData({ card: null, loading: false });
    },
    live(epoch, key) {
      return (
        this._alive &&
        this._pageVisible &&
        this.properties.visible &&
        epoch === this._epoch &&
        key === this._scopeKey
      );
    },
    cardLive(epoch, key, publicKey) {
      return (
        this.live(epoch, key) &&
        this.data.card?.publicKey === publicKey &&
        Number.isFinite(this._cardDeadline) &&
        Date.now() < this._cardDeadline
      );
    },
    stopExpiry() {
      this._expirySequence = (this._expirySequence || 0) + 1;
      this._cardDeadline = 0;
      if (this._expiryTimer) {
        clearTimeout(this._expiryTimer);
        this._expiryTimer = null;
      }
    },
    expireAfter(remaining, epoch, key, publicKey, receivedAt) {
      this.stopExpiry();
      this._cardDeadline = receivedAt + remaining;
      const sequence = this._expirySequence;
      this._expiryTimer = setTimeout(
        () => {
          if (
            sequence === this._expirySequence &&
            this.live(epoch, key) &&
            this.data.card?.publicKey === publicKey
          ) {
            this.stopObserver();
            this._cardDeadline = 0;
            this._expiryTimer = null;
            this.setData({ card: null, loading: false });
          }
        },
        Math.min(remaining, 2147483647),
      );
    },
    async refresh() {
      const epoch = this._epoch,
        key = this._scopeKey,
        scope = this._scope;
      if (!scope || !this.live(epoch, key) || this._loadingEpoch === epoch) return;
      this._loadingEpoch = epoch;
      const requestedAt = Date.now();
      this.setData({ loading: !this.data.card });
      try {
        const path =
          '/v1/public/sponsorships?regionId=' +
          scope.regionId +
          '&catalogVersion=' +
          encodeURIComponent(scope.catalogVersion) +
          '&limit=1' +
          (scope.eventPublicId ? '&eventPublicId=' + scope.eventPublicId : '');
        const response = await api.getClient().requestPublic(path);
        if (!this.live(epoch, key)) return;
        if (!response.data || !Array.isArray(response.data.items) || response.data.items.length > 1)
          throw new Error('Invalid sponsorship response');
        const next = response.data.items.length ? sponsorship.card(response.data.items[0]) : null;
        const receivedAt = Date.now(),
          remaining = next ? sponsorship.remaining(next, requestedAt, receivedAt) : 0;
        if (next && next.region.catalogVersion !== scope.catalogVersion)
          throw new Error('Region catalog mismatch');
        this.stopObserver();
        this.stopExpiry();
        if (next) this.expireAfter(remaining, epoch, key, next.publicKey, receivedAt);
        this.setData({ card: next, loading: false }, () => {
          if (next && this.live(epoch, key)) this.observe(epoch, key, next.publicKey);
        });
      } catch {
        if (this.live(epoch, key)) {
          this.stopObserver();
          this.stopExpiry();
          this.setData({ card: null, loading: false });
        }
      } finally {
        if (this._loadingEpoch === epoch) this._loadingEpoch = null;
      }
    },
    stopObserver() {
      if (this._observer) {
        this._observer.disconnect();
        this._observer = null;
      }
    },
    observe(epoch, key, publicKey) {
      this.stopObserver();
      if (
        !this.cardLive(epoch, key, publicKey) ||
        this._reports.get(publicKey)?.sent ||
        typeof wx.createIntersectionObserver !== 'function'
      )
        return;
      try {
        const observer = wx.createIntersectionObserver(this, { thresholds: [0.5] });
        this._observer = observer;
        observer.relativeToViewport().observe('#sponsorship-slot-card', (event) => {
          if (event.intersectionRatio >= 0.5 && this.cardLive(epoch, key, publicKey)) {
            observer.disconnect();
            this.report(epoch, key, publicKey).catch(() => {});
          }
        });
      } catch {
        this.stopObserver();
      }
    },
    async report(epoch, key, publicKey) {
      if (!this.cardLive(epoch, key, publicKey)) return;
      let record = this._reports.get(publicKey);
      if (record?.sent || record?.inflight) return;
      if (!record) {
        if (this._reports.size >= 128) return;
        record = { commandId: null, sent: false, inflight: false };
        this._reports.set(publicKey, record);
      }
      record.inflight = true;
      try {
        if (!record.commandId) {
          const commandId = await ui.uuid();
          if (!this.cardLive(epoch, key, publicKey)) return;
          record.commandId = commandId;
        }
        if (!this.cardLive(epoch, key, publicKey)) return;
        const response = await api
          .getClient()
          .request(
            '/v1/public/sponsorships/' + publicKey + '/impressions',
            'POST',
            { commandId: record.commandId },
            true,
          );
        if (
          response.data?.commandId !== record.commandId ||
          response.data?.publicKey !== publicKey ||
          response.data?.measurement !== 'CLIENT_REPORTED_DEDUPLICATED'
        )
          throw new Error('Unconfirmed impression');
        record.sent = true;
      } catch (error) {
        if (
          [404, 410].includes(error?.status) &&
          this.live(epoch, key) &&
          this.data.card?.publicKey === publicKey
        ) {
          this.stopObserver();
          this.stopExpiry();
          this.setData({ card: null, loading: false });
        }
      } finally {
        record.inflight = false;
      }
    },
    open() {
      const publicKey = this.data.card?.publicKey;
      if (this.cardLive(this._epoch, this._scopeKey, publicKey) && KEY.test(publicKey || ''))
        wx.navigateTo({ url: '/pages/sponsorships/index?publicKey=' + publicKey });
    },
  },
});
