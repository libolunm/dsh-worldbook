window.__ModuleLoader__.load({ id: 'dsh-worldbook-editor', factory: (require) => {
  const React = require('react')
  const { createElement } = React
  const slots = require('@deepseek-ai/dsh-client-ui-slots')
  const WorldbookSection = () => createElement('iframe', {
    title: '世界书编辑器',
    src: '/worldbook',
    style: { width: '100%', minHeight: '760px', border: '0', borderRadius: '10px', background: 'transparent' },
  })
  return {
    apply(ctx) {
      ctx.inject(['slots'], () => ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'worldbook-editor', order: 25, label: '世界书' },
        () => createElement(WorldbookSection),
      )))
    },
  }
} })
