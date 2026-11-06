Component({
  properties: {
    type: { type: String, value: 'empty' },
    title: { type: String, value: '' },
    body: { type: String, value: '' },
    actionLabel: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    action() {
      if (!this.properties.disabled) this.triggerEvent('action');
    },
  },
});
