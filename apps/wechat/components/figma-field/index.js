Component({
  properties: {
    label: { type: String, value: '' },
    value: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    hint: { type: String, value: '' },
    error: { type: String, value: '' },
    password: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    maxlength: { type: Number, value: 140 },
    cursorSpacing: { type: Number, value: 120 },
  },
  methods: {
    input(e) {
      this.triggerEvent('input', { value: e.detail.value });
    },
  },
});
