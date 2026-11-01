Component({
  properties: {
    kind: { type: String, value: 'empty' },
    title: { type: String, value: '' },
    description: { type: String, value: '' },
    actionText: { type: String, value: '' },
    secondaryText: { type: String, value: '' },
    busy: { type: Boolean, value: false },
  },
  data: {
    labels: {
      loading: '正在读取',
      empty: '暂无内容',
      error: '读取失败',
      permission: '当前无权访问',
      closed: '暂未开放',
      unknown: '结果待核对',
      conflict: '需要重新核对',
      success: '已完成',
    },
  },
  methods: {
    action() {
      if (!this.properties.busy) this.triggerEvent('action');
    },
    secondary() {
      if (!this.properties.busy) this.triggerEvent('secondary');
    },
  },
});
