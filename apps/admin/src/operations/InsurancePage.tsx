import { useCallback, useMemo, useState } from 'react';
import type { InsuranceOrderData } from '@small-city-basketball/contracts';
import { createOperationsApi } from '../api/operations';
import {
  ActionNotice,
  PageHeading,
  ResourceState,
  Version,
  useAction,
  useResource,
} from '../registration/shared';
import type { RegistrationWorkspace } from '../registration/shared';
import { fenText } from './shared';

const paymentLabels: Record<string, string> = {
  UNPAID: '未付款',
  PENDING: '付款待核对',
  PAID: '付款已由服务方确认',
  REFUND_PENDING: '退款待核对',
  REFUNDED: '退款已由服务方确认',
  FAILED: '付款失败',
};
const policyLabels: Record<string, string> = {
  PENDING: '待出单',
  ISSUED: '服务方已出单',
  FAILED: '出单失败',
  CANCEL_PENDING: '退保待核对',
  CANCELLED: '已退保',
};

export function InsuranceOperationsPage({ context }: { context: RegistrationWorkspace }) {
  const api = useMemo(() => createOperationsApi(context.client), [context.client]);
  const read = useCallback(() => api.insuranceWorkspace(), [api]);
  const resource = useResource(read);
  const action = useAction();
  const data = resource.data;
  return (
    <div className="registration-page">
      <PageHeading
        eyebrow="INSURANCE OPERATIONS"
        title="保险运营"
        description="列表是当前登录账号自己的保单，不是本机构全部参保记录。只做核对、刷新和退保申请，不发起投保，也不把申请写成承保成功。"
      />
      {resource.loading || resource.error || !data ? (
        <ResourceState loading={resource.loading} error={resource.error} reload={resource.reload} />
      ) : (
        <>
          <ActionNotice action={action} onReload={resource.reload} />
          <div className="registration-alert" role="status">
            <strong>{data.enabled ? '在线投保入口按服务端准入开启' : '在线投保未开放'}</strong>
            <p>{data.reason ?? data.notice}</p>
          </div>
          {data.orders.length === 0 && (
            <section className="panel">
              <h2>暂无保单</h2>
              <p>已有外部保单的审核进度会出现在这里。没有记录时不会显示已承保。</p>
            </section>
          )}
          <ul>
            {data.orders.map((order) => (
              <li key={order.id}>
                <OrderCard
                  order={order}
                  busy={action.busy}
                  onCommand={(type) =>
                    void action.run(async () => {
                      await api.post(`/v1/insurance/orders/${order.id}/commands`, {
                        clientRequestId: crypto.randomUUID(),
                        expectedVersion: order.version,
                        type,
                      });
                      if (action.isActive()) {
                        resource.reload();
                        await context.onSessionRefresh();
                      }
                    }, '已提交核对，请以重新读取的保单状态为准')
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function OrderCard({
  order,
  busy,
  onCommand,
}: {
  order: InsuranceOrderData;
  busy: boolean;
  onCommand: (type: 'REFRESH' | 'REQUEST_CANCELLATION') => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <article className="panel">
      <h2>
        {policyLabels[order.policyStatus] ?? order.policyStatus} <Version value={order.version} />
      </h2>
      <p>
        {paymentLabels[order.paymentStatus] ?? order.paymentStatus} · 保费{' '}
        {fenText(order.premiumFen)}
        {order.refundedFen !== null ? ` · 已退 ${fenText(order.refundedFen)}` : ''}
      </p>
      <p>
        保障 {order.coverageStartDate} 至 {order.coverageEndDate}
        {order.maskedPolicyNumber ? ` · 保单号 ${order.maskedPolicyNumber}` : ' · 尚无服务方保单号'}
      </p>
      {order.reconciliationRequired && <p>这笔记录需要继续核对，不能当作已完成。</p>}
      {order.pendingOperation && <p>原操作 {order.pendingOperation} 仍在处理中，请先刷新原单。</p>}
      {order.canRefresh && (
        <button type="button" disabled={busy} onClick={() => onCommand('REFRESH')}>
          刷新原单
        </button>
      )}
      {order.canRequestCancellation && !confirm && (
        <button type="button" disabled={busy} onClick={() => setConfirm(true)}>
          申请退保
        </button>
      )}
      {confirm && (
        <p>
          提交只表示申请退保，不表示已退保或款项到账。
          <button type="button" disabled={busy} onClick={() => onCommand('REQUEST_CANCELLATION')}>
            确认提交退保申请
          </button>
        </p>
      )}
    </article>
  );
}
