const api = require('./api');
const ui = require('./ui');
const files = require('./participant-materials');
const youth = require('./youth-guardians');
const form = () => ({
  subjectAlias: '',
  guardianUserId: '',
  declaredYouth: false,
  acceptedDataProcessing: false,
  adultAcceptedDataProcessing: false,
  acceptedTerms: false,
  publicityConsent: false,
  archiveConsent: false,
  liveConsent: false,
  realName: '',
  identityNumber: '',
  relationship: 'PARENT',
  relationshipExplanation: '',
});
function createPage(review = false) {
  const path = '/pages/' + (review ? 'youth-review' : 'guardian') + '/index';
  return {
    data: {
      review,
      hasMaterialScope: false,
      requests: [],
      preconsents: [],
      adultDataScopes: [],
      adultSelected: null,
      selected: null,
      policy: null,
      form: form(),
      proofName: '',
      privateDetails: null,
      reason: '',
      identityChecked: false,
      relationshipChecked: false,
      policyEnabled: false,
      threshold: '18',
      loading: false,
      busy: false,
      pending: false,
      nextCursor: null,
      error: '',
      message: '',
      loginRequired: false,
    },
    onLoad(q = {}) {
      this._alive = true;
      this._visible = true;
      this._temps = [];
      try {
        if (q.orgId || q.eventId) {
          this._org = files.id(q.orgId);
          this._event = files.id(q.eventId);
        }
        if (q.entryId || q.memberId) {
          this._entry = files.id(q.entryId);
          this._member = files.id(q.memberId);
          this.setData({ hasMaterialScope: true });
        }
        if (review && !this._org) throw new Error('请从赛事管理进入独立监护审核');
      } catch (e) {
        this._invalid = true;
        this.setData({ error: ui.message(e) });
      }
    },
    onShow() {
      this._visible = true;
      files.sweepTemps(wx);
      if (!this.data.busy) this.load();
    },
    onHide() {
      this._visible = false;
      ui.close(this);
      this.clearPrivate();
      this.cleanup();
    },
    onUnload() {
      this._alive = false;
      this.onHide();
    },
    onSessionReset() {
      this._viewer = null;
      this.clearPrivate();
      this.cleanup();
      this.setData({ loginRequired: true, error: '登录身份已变化，请重新读取当前监护资料。' });
    },
    clearPrivate() {
      this._selected = null;
      this._adultSelected = null;
      this._chosen = null;
      this._pending = null;
      this.setData({
        requests: [],
        preconsents: [],
        adultDataScopes: [],
        adultSelected: null,
        selected: null,
        policy: null,
        privateDetails: null,
        form: form(),
        proofName: '',
        reason: '',
        identityChecked: false,
        relationshipChecked: false,
        loading: false,
        busy: false,
        pending: false,
        nextCursor: null,
      });
    },
    cleanup() {
      for (const p of this._temps || []) files.releaseTemp(wx, p);
      this._temps = [];
    },
    returnPath() {
      return (
        path +
        (this._org
          ? '?orgId=' +
            this._org +
            '&eventId=' +
            this._event +
            (this._entry ? '&entryId=' + this._entry + '&memberId=' + this._member : '')
          : '')
      );
    },
    login() {
      ui.login(this.returnPath());
    },
    repo() {
      return youth.repository(this._org, this._event);
    },
    async actor(token) {
      const session = await ui.session(this, this.returnPath());
      return (
        session &&
        ui.held(this, token) &&
        this._visible &&
        session.user.id === this._viewer &&
        api.getClient().viewerId() === this._viewer
      );
    },
    async load(e) {
      const more =
        e?.currentTarget?.dataset?.more === true || e?.currentTarget?.dataset?.more === 'true';
      if (
        this._invalid ||
        this.data.busy ||
        !this._visible ||
        this.data.loading ||
        (more && !this.data.nextCursor)
      )
        return;
      const cursor = more ? this.data.nextCursor : null;
      if (!more) this.clearPrivate();
      let token = ui.begin(this);
      this.setData({ loading: true, error: '', message: '' });
      try {
        const session = await ui.session(this, this.returnPath());
        if (!session || !ui.live(this, token) || !this._visible) return;
        if (api.getClient().viewerId() !== session.user.id) return;
        this._viewer = session.user.id;
        if (!more) {
          const pending = youth.readPending(wx, this._viewer);
          this._pending = pending;
          this.setData({ pending: !!pending });
          if (pending) {
            const receipt = await this.repo().receipt(pending.clientRequestId);
            if (!ui.live(this, token)) return;
            if (receipt.found) {
              if (!youth.clearPending(wx, pending))
                throw new Error('原请求已确认，但本机保护记录无法清除');
              this._pending = null;
              this.setData({ pending: false, message: '原请求已由服务器确认，请核对当前状态。' });
            } else
              this.setData({
                message: '原请求尚未找到，仍可能在途。请稍后核对回执，暂不新建操作。',
              });
          }
        }
        const value = review
          ? await this.repo().queue(cursor)
          : await this.repo().workspace(cursor);
        if (!ui.live(this, token) || !this._visible) return;
        this.setData({
          requests: more ? this.data.requests.concat(value.requests) : value.requests,
          preconsents: review
            ? []
            : more
              ? this.data.preconsents.concat(value.preconsents)
              : value.preconsents,
          adultDataScopes: review
            ? []
            : more
              ? this.data.adultDataScopes.concat(
                  value.adultDataScopes.filter(
                    (scope) => !this.data.adultDataScopes.some((prior) => prior.key === scope.key),
                  ),
                )
              : value.adultDataScopes,
          nextCursor: value.nextCursor,
          loginRequired: false,
        });
        if (this._org && !more) {
          const policy = await this.repo().policy();
          if (ui.live(this, token))
            this.setData({
              policy,
              policyEnabled: policy.enabled,
              threshold: String(policy.guardianAgeThreshold),
            });
        }
      } catch (error) {
        if (ui.live(this, token)) this.setData({ error: ui.message(error) });
      } finally {
        if (ui.live(this, token)) this.setData({ loading: false });
      }
    },
    field(e) {
      if (this.data.busy || this.data.pending) return;
      const k = e.currentTarget.dataset.field;
      if (
        [
          'subjectAlias',
          'guardianUserId',
          'realName',
          'identityNumber',
          'relationshipExplanation',
        ].includes(k)
      )
        this.setData({ ['form.' + k]: e.detail.value });
      else if (k === 'reason') this.setData({ reason: e.detail.value });
      else if (k === 'threshold' && review) this.setData({ threshold: e.detail.value });
    },
    relationship(e) {
      if (!this.data.busy && !this.data.pending)
        this.setData({
          'form.relationship': e.detail.value === 'LEGAL_GUARDIAN' ? 'LEGAL_GUARDIAN' : 'PARENT',
        });
    },
    checkbox(e) {
      if (this.data.busy || this.data.pending) return;
      const k = e.currentTarget.dataset.field,
        v = Array.isArray(e.detail.value) && e.detail.value.includes('yes');
      if (
        [
          'declaredYouth',
          'acceptedDataProcessing',
          'adultAcceptedDataProcessing',
          'acceptedTerms',
          'publicityConsent',
          'archiveConsent',
          'liveConsent',
        ].includes(k)
      )
        this.setData({ ['form.' + k]: v });
      else if (['identityChecked', 'relationshipChecked', 'policyEnabled'].includes(k))
        this.setData({ [k]: v });
    },
    async chooseProof() {
      if (this.data.busy || this.data.pending || !this._selected?.capabilities.canConfirm) return;
      const token = ui.hold(this);
      this.setData({ busy: true, error: '' });
      try {
        if (!(await this.actor(token))) return;
        const chosen = await files.chooseFile(wx, 'insurance');
        if (ui.held(this, token) && this._visible) {
          this._chosen = chosen;
          this.setData({ proofName: chosen.name });
        }
      } catch (e) {
        if (ui.held(this, token)) this.setData({ error: ui.message(e) });
      } finally {
        if (ui.held(this, token)) this.setData({ busy: false });
      }
    },
    async select(e) {
      if (this.data.busy || this.data.loading) return;
      const id = e.currentTarget.dataset.id;
      if (!this.data.requests.some((r) => r.id === id)) return;
      const token = ui.begin(this);
      this._chosen = null;
      this._selected = null;
      this.cleanup();
      this.setData({
        selected: null,
        privateDetails: null,
        form: form(),
        proofName: '',
        reason: '',
        identityChecked: false,
        relationshipChecked: false,
        error: '',
      });
      try {
        const selected = await this.repo().detail(id);
        if (ui.live(this, token) && this._visible) {
          this._selected = selected;
          this.setData({ selected });
        }
      } catch (error) {
        if (ui.live(this, token)) this.setData({ error: ui.message(error) });
      }
    },
    async adultSelect(e) {
      if (review || this.data.busy || this.data.loading || this.data.pending) return;
      const chosen = this.data.adultDataScopes.find(
        (scope) => scope.key === e.currentTarget.dataset.key,
      );
      if (!chosen) return;
      const token = ui.hold(this);
      this._adultSelected = null;
      this.setData({
        busy: true,
        adultSelected: null,
        'form.adultAcceptedDataProcessing': false,
        error: '',
      });
      try {
        if (!(await this.actor(token))) return;
        const current = await this.repo().adultCapability(chosen);
        if (ui.held(this, token) && this._visible) {
          this._adultSelected = current;
          this.setData({ adultSelected: current });
        }
      } catch (error) {
        if (ui.held(this, token)) this.setData({ error: ui.message(error) });
      } finally {
        if (ui.held(this, token)) this.setData({ busy: false });
      }
    },
    adultDataCommand(e) {
      if (review || this.data.busy || this.data.loading || this.data.pending) return;
      const scope = this._adultSelected,
        decision = e.currentTarget.dataset.decision;
      if (
        !scope ||
        !['CONSENT', 'WITHDRAW'].includes(decision) ||
        (decision === 'CONSENT' && !scope.canConsent) ||
        (decision === 'WITHDRAW' && !scope.canWithdraw)
      )
        return;
      if (decision === 'CONSENT' && !this.data.form.adultAcceptedDataProcessing) {
        this.setData({ error: '请本人阅读并明确同意当前资料处理内容。' });
        return;
      }
      return this.mutate(
        decision === 'CONSENT' ? '本人重新同意当前资料处理' : '撤回本人资料处理同意',
        decision === 'CONSENT'
          ? '仅重新确认本届当前材料的必要私有处理。成年状态由受保护的独立核验资料和服务器当前日期确认；本次不会恢复原有公开用途，也不代表参赛或保险审核通过。'
          : '停止基于本次本人同意的后续资料处理，保留必要历史记录。本次撤回不需要重新提交身份证或关系证明。',
        async () => {
          if (
            this._adultSelected !== scope ||
            (decision === 'CONSENT' && !this.data.form.adultAcceptedDataProcessing)
          )
            return null;
          return {
            entryId: scope.entryId,
            memberId: scope.memberId,
            expectedAdultVersion: scope.expectedAdultVersion,
            decision,
            ...(decision === 'CONSENT'
              ? {
                  expectedMaterialVersion: scope.expectedMaterialVersion,
                  expectedPolicyVersion: scope.policyVersion,
                  evidenceQualificationId: scope.evidenceQualificationId,
                  acceptedDataProcessing: true,
                  termsVersion: scope.termsVersion,
                }
              : {}),
          };
        },
        (body) => this.repo().adultData(scope, body),
      );
    },
    async mutate(title, content, makeBody, send) {
      if (this.data.busy || this.data.loading || this.data.pending) return;
      const op = await ui.confirmOp(this, title, content);
      if (!op || this.data.busy || this.data.pending) return;
      const token = ui.hold(this),
        viewer = this._viewer;
      let record,
        sent = false,
        reload = false;
      this.setData({ busy: true, error: '', message: '', privateDetails: null });
      try {
        if (!(await this.actor(token)) || !op.valid()) return;
        const body = await makeBody(token);
        if (body === null || !op.valid() || !ui.held(this, token) || !this._visible) return;
        const clientRequestId = await ui.uuid();
        if (!op.valid() || !ui.held(this, token) || !this._visible || viewer !== this._viewer)
          return;
        record = { userId: viewer, clientRequestId };
        if (!youth.writePending(wx, record)) throw new Error('无法保存原请求编号，未发送资料');
        this._pending = record;
        this.setData({ pending: true });
        if (!op.valid() || !ui.held(this, token) || !this._visible) {
          youth.clearPending(wx, record);
          return;
        }
        sent = true;
        await send({ ...body, clientRequestId });
        const cleared = youth.clearPending(wx, record);
        if (ui.held(this, token)) {
          this._pending = cleared ? null : record;
          this.setData({
            pending: !cleared,
            message: cleared ? '操作已保存，正在读取当前版本。' : '操作已保存，请重新核对原请求。',
          });
          reload = cleared;
        }
      } catch (error) {
        const resolved =
          record && (!sent || !files.unknown(error)) && youth.clearPending(wx, record);
        if (ui.held(this, token)) {
          if (resolved) {
            this._pending = null;
            this.setData({ pending: false });
          }
          this.setData({
            error: error?.cancelled ? '' : ui.message(error),
            message:
              sent && files.unknown(error) ? '结果未知，已仅保留原请求编号。请重新核对回执。' : '',
          });
        }
      } finally {
        if (ui.held(this, token)) {
          this._chosen = null;
          this.setData({
            busy: false,
            'form.identityNumber': '',
            'form.realName': '',
            'form.relationshipExplanation': '',
            'form.adultAcceptedDataProcessing': false,
            proofName: '',
          });
          if (reload) await this.load();
        }
      }
    },
    configure() {
      if (!this.data.policy?.canConfigure) return;
      const p = this.data.policy,
        enabled = this.data.policyEnabled,
        guardianAgeThreshold = Number(this.data.threshold);
      return this.mutate(
        '配置青年报名规则',
        '仅在开放报名前设置。年龄阈值是本赛事业务规则；不能关闭未满14岁必要资料处理的监护确认。',
        async () => ({ expectedVersion: p.version || null, enabled, guardianAgeThreshold }),
        (body) => this.repo().configure(body),
      );
    },
    invite() {
      if (!this.data.policy?.enabled || !this.data.policy.canInviteData) return;
      const f = { ...this.data.form },
        p = this.data.policy;
      if (!f.declaredYouth) {
        this.setData({ error: '请明确选择青年报名入口。年龄仍须独立核验。' });
        return;
      }
      return this.mutate(
        '邀请监护人先确认资料处理',
        '仅发送本页别名和本届赛事，不发送孩子身份证、照片或保单。请核对已有监护账号编号。',
        async () => ({
          subjectAlias: f.subjectAlias.trim(),
          guardianUserId: files.id(f.guardianUserId.trim()),
          declaredYouth: true,
          expectedPolicyVersion: p.version,
        }),
        (body) => this.repo().invite(body),
      );
    },
    dataDecision(e) {
      const r = this.data.preconsents.find((x) => x.id === e.currentTarget.dataset.id),
        decision = e.currentTarget.dataset.decision;
      if (
        !r ||
        !['CONSENT', 'DECLINE', 'WITHDRAW'].includes(decision) ||
        (decision !== 'WITHDRAW' && (r.role !== 'GUARDIAN' || r.status !== 'INVITED'))
      )
        return;
      if (decision === 'CONSENT' && !this.data.form.acceptedDataProcessing) {
        this.setData({ error: '请监护人先阅读并明确勾选必要资料处理内容。' });
        return;
      }
      return this.mutate(
        decision === 'WITHDRAW' ? '撤回必要资料处理同意' : '监护人确认必要资料处理',
        '仅用于本届私有身份、照片、资格和保障核验。不同意或撤回将阻止后续青年资料收集和新参赛动作；依法或争议所需历史记录按留存处理。此步骤不代表监护关系或最终参赛审核通过。',
        async () => ({
          decision,
          expectedVersion: r.version,
          acceptedDataProcessing: decision === 'CONSENT',
          dataTermsVersion: 'youth-data-processing-v1',
        }),
        (body) => this.repo().data(r.id, body),
      );
    },
    materials() {
      if (this._org && this._entry)
        ui.open('participant-materials', { orgId: this._org, entryId: this._entry });
    },
    propose() {
      const p = this.data.policy,
        f = { ...this.data.form };
      if (!p?.enabled || !this._entry || !this._member) return;
      if (!f.acceptedTerms) {
        this.setData({ error: '请本人阅读并确认本届参赛内容。' });
        return;
      }
      return this.mutate(
        '本人提出本届监护及用途确认',
        '仅针对当前已核验本人资料、名单和规则。监护人还需独立确认及提交证明，组委会另行核验关系。',
        async () => ({
          entryId: this._entry,
          memberId: this._member,
          expectedPolicyVersion: p.version,
          acceptedTerms: true,
          termsVersion: 'youth-participation-v1',
          publicityConsent: f.publicityConsent,
          archiveConsent: f.archiveConsent,
          liveConsent: f.liveConsent,
        }),
        (body) => this.repo().propose(body),
      );
    },
    confirmGuardian() {
      const r = this._selected,
        f = { ...this.data.form },
        chosen = this._chosen;
      if (!r?.capabilities.canConfirm) return;
      if (!f.acceptedTerms || !chosen) {
        this.setData({ error: '请监护人明确同意本届参赛内容并选择关系证明。' });
        return;
      }
      return this.mutate(
        '监护人独立确认及提交关系证明',
        '请以监护人自己的身份填写。提交不自动证明关系有效，须无关联审核人独立核验；不能因此读取孩子私密材料。',
        async (token) => {
          const base64 = await files.readBase64(wx, chosen);
          if (!ui.held(this, token) || this._selected !== r) return null;
          return {
            expectedVersion: r.version,
            realName: f.realName.trim(),
            identityNumber: f.identityNumber.trim().toUpperCase(),
            relationship: f.relationship,
            relationshipExplanation: f.relationshipExplanation.trim(),
            proof: { fileName: chosen.name, contentType: chosen.contentType, base64 },
            acceptedTerms: true,
            termsVersion: 'youth-participation-v1',
            publicityConsent: f.publicityConsent,
            archiveConsent: f.archiveConsent,
            liveConsent: f.liveConsent,
          };
        },
        (body) => this.repo().act(r.id, 'confirm', body),
      );
    },
    withdraw() {
      const r = this._selected;
      if (!r?.capabilities.canWithdraw) return;
      return this.mutate(
        '撤回监护确认',
        '立即停止基于该确认的新参赛和公开用途；保留已冻结名单、已消费赛果及必要审计。撤回后重新办理需双方重新确认和审核。',
        async () => ({ expectedVersion: r.version }),
        (body) => this.repo().act(r.id, 'withdraw', body),
      );
    },
    review(e) {
      const r = this._selected,
        decision = e.currentTarget.dataset.decision,
        reason = this.data.reason.trim(),
        identityChecked = this.data.identityChecked,
        relationshipChecked = this.data.relationshipChecked;
      if (!r?.capabilities.canReview || !['APPROVE', 'REJECT'].includes(decision)) return;
      if (
        reason.length < 4 ||
        (decision === 'APPROVE' && (!identityChecked || !relationshipChecked))
      ) {
        this.setData({ error: '请写审核说明，并在通过前独立核验监护身份、成年及关系。' });
        return;
      }
      return this.mutate(
        '独立审核当前监护证明',
        '仅处理此版本关系证明，不能替代本人资格、保险和最终报名审核。本人、监护人及关联球队人员不能自审。',
        async () => ({
          expectedVersion: r.version,
          decision,
          reason,
          identityChecked,
          relationshipChecked,
        }),
        (body) => this.repo().act(r.id, 'review', body),
      );
    },
    async reveal() {
      const r = this._selected;
      if (!r?.capabilities.canReadProof || this.data.busy || this.data.pending) return;
      const op = await ui.confirmOp(
        this,
        '查看监护人的受保护证明',
        '仅用于本人核对或有权的独立关系审核。本次访问留有审计，请勿转发。',
      );
      if (!op) return;
      const token = ui.hold(this);
      this.setData({ busy: true, privateDetails: null, error: '' });
      try {
        if (!(await this.actor(token)) || !op.valid()) return;
        const p = await this.repo().private(r.id);
        if (ui.held(this, token) && op.valid() && this._selected === r && this._visible)
          this.setData({ privateDetails: p });
      } catch (e) {
        if (ui.held(this, token)) this.setData({ error: ui.message(e) });
      } finally {
        if (ui.held(this, token)) this.setData({ busy: false });
      }
    },
    conceal() {
      this.setData({ privateDetails: null });
      this.cleanup();
    },
    async viewProof() {
      const r = this._selected,
        p = this.data.privateDetails?.proof;
      if (!r?.capabilities.canReadProof || !p || this.data.busy || this.data.pending) return;
      const token = ui.hold(this);
      this.setData({ busy: true, error: '' });
      let file;
      try {
        if (!(await this.actor(token))) return;
        const d = await this.repo().download(r.id);
        if (!ui.held(this, token) || !this._visible || this._selected !== r) return;
        if (d.contentType !== p.contentType || d.data.byteLength !== p.byteLength)
          throw new Error('证明版本已变化，请重新读取');
        const suffix =
          p.contentType === 'application/pdf'
            ? 'pdf'
            : p.contentType === 'image/png'
              ? 'png'
              : 'jpg';
        const key = await ui.uuid();
        if (!ui.held(this, token) || !this._visible) return;
        file = wx.env.USER_DATA_PATH + '/scb-participant-' + key + '.' + suffix;
        if (!files.trackTemp(wx, file)) throw new Error('无法登记私有临时文件，已停止预览');
        this._temps.push(file);
        await new Promise((resolve, reject) =>
          wx
            .getFileSystemManager()
            .writeFile({ filePath: file, data: d.data, success: resolve, fail: reject }),
        );
        if (!ui.held(this, token) || !this._visible || this._selected !== r) {
          files.releaseTemp(wx, file);
          return;
        }
        const fail = () => files.releaseTemp(wx, file);
        if (suffix === 'pdf')
          wx.openDocument({ filePath: file, fileType: 'pdf', showMenu: false, fail });
        else wx.previewImage({ current: file, urls: [file], showmenu: false, fail });
      } catch (e) {
        if (file) files.releaseTemp(wx, file);
        if (ui.held(this, token)) this.setData({ error: ui.message(e) });
      } finally {
        if (ui.held(this, token)) this.setData({ busy: false });
      }
    },
  };
}
module.exports = { createPage };
