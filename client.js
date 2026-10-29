/**
 * Browser half: the Memory page in Settings.
 *
 * It is a settings section rather than a composer dock because global memory is
 * edited rarely and read always — a permanent strip above the input would be
 * noise. What the model sees is decided by the Host; this page only edits.
 *
 * @module global-memory-client
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-global-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const NS = 'global-memory'
    const STYLE_ID = '@local/dsh-global-memory/MemorySettings.css'
    const API = '/plugins/global-memory'

    // ------------------------------------------------------------------ copy

    const zh = {
      'meta.locale': 'zh-CN',
      'section.title': '记忆',
      'intro': '这里的条目会出现在你所有的对话里。只放需要每次都遵守的短句；长流程放进 skill 或项目的 AGENTS.md。',
      'usage.label': '占用',
      'usage.value': '{tokens} / {budget} token',
      'usage.near': '接近上限，考虑删掉一些不再需要的内容。',
      'usage.over': '已超出上限，现在不会回答任何请求，直到删减到上限以内。',
      'usage.dupes': '有 {count} 条重复内容已在注入时合并显示。',
      'add.placeholder': '例如：回答一律用中文',
      'add.action': '添加',
      'add.tagsHint': '标签（可选，逗号分隔）',
      'empty.title': '还没有记忆',
      'empty.body': '添加第一条，它会从下一个对话开始生效。',
      'entry.disabled': '已停用',
      'entry.enable': '启用',
      'entry.disable': '停用',
      'entry.edit': '编辑',
      'entry.save': '保存',
      'entry.cancel': '取消',
      'entry.remove': '删除',
      'entry.confirmRemove': '确定删除这条记忆？',
      'error.stale': '这份记忆已在别处被修改，请刷新后再改。',
      'action.refresh': '刷新',
      'action.reload': '重新读取',
      'action.reloadHint': '从磁盘重读。手工改过存储文件或恢复了备份后使用。',
      'loading': '加载中…',
    }

    const en = {
      'meta.locale': 'en-US',
      'section.title': 'Memory',
      'intro': 'These entries appear in every conversation. Keep them to short statements that always apply; put long procedures in a skill or the project AGENTS.md.',
      'usage.label': 'Usage',
      'usage.value': '{tokens} / {budget} tokens',
      'usage.near': 'Close to the limit; consider removing what you no longer need.',
      'usage.over': 'Over the limit. No request will be answered until it fits again.',
      'usage.dupes': '{count} duplicate(s) are already merged when injected.',
      'add.placeholder': 'e.g. Always answer in Chinese',
      'add.action': 'Add',
      'add.tagsHint': 'Tags (optional, comma separated)',
      'empty.title': 'No memory yet',
      'empty.body': 'Add the first entry; it applies from the next conversation.',
      'entry.disabled': 'Disabled',
      'entry.enable': 'Enable',
      'entry.disable': 'Disable',
      'entry.edit': 'Edit',
      'entry.save': 'Save',
      'entry.cancel': 'Cancel',
      'entry.remove': 'Delete',
      'entry.confirmRemove': 'Delete this memory?',
      'error.stale': 'This memory changed elsewhere; refresh before editing.',
      'action.refresh': 'Refresh',
      'action.reload': 'Reload from disk',
      'action.reloadHint': 'Re-read the stored file. Use after editing it by hand or restoring a backup.',
      'loading': 'Loading…',
    }

    // ----------------------------------------------------------------- style

    const CSS = `
.gm-section { display: flex; flex-direction: column; gap: 14px; padding: 4px 2px 24px; font-size: 13px; color: var(--dsw-alias-label-primary); }
.gm-intro { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; margin: 0; }
.gm-usage { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); font-size: 12px; }
.gm-usage-label { color: var(--dsw-alias-label-secondary); }
.gm-usage-value { font-variant-numeric: tabular-nums; font-weight: 600; }
.gm-usage-spacer { flex: 1; }
.gm-usage[data-state="over"] { border-color: var(--dsw-alias-state-error-primary); }
.gm-usage[data-state="over"] .gm-usage-value { color: var(--dsw-alias-state-error-primary); }
.gm-usage-note { flex-basis: 100%; color: var(--dsw-alias-label-secondary); font-size: 11px; }
.gm-usage[data-state="over"] .gm-usage-note { color: var(--dsw-alias-state-error-primary); }
.gm-form { display: flex; flex-direction: column; gap: 6px; }
.gm-input { box-sizing: border-box; width: 100%; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; line-height: 1.5; }
.gm-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.gm-form-row { display: flex; align-items: center; gap: 8px; }
.gm-btn { padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; cursor: pointer; }
.gm-btn:hover { background: var(--dsw-alias-bg-layer-2); }
.gm-btn[data-variant="primary"] { background: var(--dsw-alias-brand-primary); border-color: transparent; color: #fff; }
.gm-btn[data-variant="danger"]:hover { color: var(--dsw-alias-state-error-primary); }
.gm-btn:disabled { opacity: 0.5; cursor: default; }
.gm-list { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.gm-row { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-2); }
.gm-row[data-disabled="true"] .gm-text { color: var(--dsw-alias-label-secondary); text-decoration: line-through; }
.gm-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.gm-text { line-height: 1.55; word-break: break-word; }
.gm-meta { display: flex; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 11px; flex-wrap: wrap; }
.gm-tag { padding: 0 5px; border-radius: 4px; background: var(--dsw-alias-bg-layer-1); }
.gm-row-actions { display: flex; gap: 4px; flex: none; }
.gm-empty { display: flex; flex-direction: column; gap: 4px; padding: 18px 12px; text-align: center; border: 1px dashed var(--dsw-alias-border-l1); border-radius: 8px; color: var(--dsw-alias-label-secondary); }
.gm-empty-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
.gm-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }
`

    /** Install the stylesheet once; return its removal. */
    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`)
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/dsh-global-memory'
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /** One API call with the plugin's error convention. */
    async function request(path, init) {
      const response = await fetch(API + path, {
        cache: 'no-store',
        ...init,
        headers: { accept: 'application/json', 'content-type': 'application/json', ...(init?.headers ?? {}) },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok !== true) {
        const error = new Error(payload?.message || `HTTP ${response.status}`)
        error.code = payload?.code
        throw error
      }
      return payload
    }

    /** Parse a comma separated tag list. */
    function parseTags(value) {
      return String(value ?? '').split(/[,，]/).map((tag) => tag.trim()).filter((tag) => tag !== '')
    }

    /** The edit form, reused for the add box and per-entry edits. */
    function EntryForm({ t, initial, busy, onSubmit, onCancel }) {
      const [text, setText] = useState(initial?.text ?? '')
      const [tags, setTags] = useState((initial?.tags ?? []).join(', '))
      const submit = () => {
        if (text.trim() === '') return
        onSubmit({ text, tags: parseTags(tags) })
      }
      return h(
        'div',
        { className: 'gm-form' },
        h('textarea', {
          className: 'gm-input',
          rows: initial === undefined ? 2 : 3,
          value: text,
          placeholder: t('add.placeholder'),
          onChange: (event) => setText(event.target.value),
        }),
        h('input', {
          className: 'gm-input',
          value: tags,
          placeholder: t('add.tagsHint'),
          onChange: (event) => setTags(event.target.value),
        }),
        h(
          'div',
          { className: 'gm-form-row' },
          h('button', {
            type: 'button',
            className: 'gm-btn',
            'data-variant': 'primary',
            disabled: busy || text.trim() === '',
            onClick: submit,
          }, t(initial === undefined ? 'add.action' : 'entry.save')),
          onCancel === undefined ? null : h('button', { type: 'button', className: 'gm-btn', onClick: onCancel }, t('entry.cancel')),
        ),
      )
    }

    /** One stored memory. */
    function Entry({ t, entry, busy, onToggle, onRemove, onSave }) {
      const [editing, setEditing] = useState(false)
      const [confirming, setConfirming] = useState(false)
      if (editing) {
        return h('li', { className: 'gm-row' }, h(EntryForm, {
          t,
          initial: entry,
          busy,
          onSubmit: (value) => { onSave(entry.id, value); setEditing(false) },
          onCancel: () => setEditing(false),
        }))
      }
      return h(
        'li',
        { className: 'gm-row', 'data-disabled': String(entry.enabled !== true) },
        h(
          'div',
          { className: 'gm-row-main' },
          h('span', { className: 'gm-text' }, entry.text),
          h(
            'div',
            { className: 'gm-meta' },
            entry.tags.map((tag) => h('span', { key: tag, className: 'gm-tag' }, tag)),
            h('span', null, `${entry.chars} 字`),
            entry.enabled !== true ? h('span', null, t('entry.disabled')) : null,
          ),
        ),
        h(
          'div',
          { className: 'gm-row-actions' },
          h('button', {
            type: 'button',
            className: 'gm-btn',
            disabled: busy,
            onClick: () => onToggle(entry),
          }, t(entry.enabled === true ? 'entry.disable' : 'entry.enable')),
          h('button', { type: 'button', className: 'gm-btn', disabled: busy, onClick: () => setEditing(true) }, t('entry.edit')),
          h('button', {
            type: 'button',
            className: 'gm-btn',
            'data-variant': 'danger',
            disabled: busy,
            onClick: () => {
              if (confirming) { onRemove(entry.id); return }
              setConfirming(true)
            },
            onBlur: () => setConfirming(false),
          }, confirming ? t('entry.confirmRemove') : t('entry.remove')),
        ),
      )
    }

    /** The settings section itself. */
    function MemorySettings(props) {
      const t = props.t
      const [state, setState] = useState(null)
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        try {
          const payload = await request('/state')
          setState(payload.state)
          setError(null)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      }, [])

      useEffect(() => { void load() }, [load])

      /** Run one mutation, then adopt the state the host returned. */
      const mutate = useCallback(async (path, body) => {
        setBusy(true)
        try {
          const payload = await request(path, { method: 'POST', body: JSON.stringify({ ...body, revision: state?.revision }) })
          setState(payload.state)
          setError(null)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }, [state])

      /**
       * Re-read the store from disk.
       *
       * The host keeps the document in memory, so a change made outside it
       * (hand-editing the JSON, restoring a backup) is invisible until reopened.
       * This button is the manual escape hatch for exactly that case.
       */
      const reload = useCallback(async () => {
        setBusy(true)
        try {
          const payload = await request('/reload', { method: 'POST' })
          setState(payload.state)
          setError(null)
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
          setBusy(false)
        }
      }, [])

      const usage = state?.usage
      const entries = useMemo(() => (Array.isArray(state?.entries) ? state.entries : []), [state])
      const usageState = usage === undefined ? 'ok' : usage.fits === false ? 'over' : usage.tokens / usage.budget > 0.85 ? 'near' : 'ok'

      if (state === null) {
        return h('div', { className: 'gm-section' }, error === null ? t('loading') : h('div', { className: 'gm-error' }, error))
      }

      return h(
        'div',
        { className: 'gm-section' },
        h('p', { className: 'gm-intro' }, t('intro')),
        h(
          'div',
          { className: 'gm-usage', 'data-state': usageState },
          h('span', { className: 'gm-usage-label' }, t('usage.label')),
          h('span', { className: 'gm-usage-value' }, t('usage.value', { tokens: String(usage.tokens), budget: String(usage.budget) })),
          h('span', { className: 'gm-usage-spacer' }),
          h('button', {
            type: 'button',
            className: 'gm-btn',
            disabled: busy,
            title: t('action.reloadHint'),
            onClick: () => void reload(),
          }, t('action.reload')),
          usageState === 'over' ? h('span', { className: 'gm-usage-note' }, t('usage.over')) : null,
          usageState === 'near' ? h('span', { className: 'gm-usage-note' }, t('usage.near')) : null,
          usage.duplicateCount > 0 ? h('span', { className: 'gm-usage-note' }, t('usage.dupes', { count: String(usage.duplicateCount) })) : null,
        ),
        h(EntryForm, { t, busy, onSubmit: (value) => void mutate('/add', value) }),
        error === null ? null : h('div', { className: 'gm-error', role: 'alert' }, error),
        entries.length === 0
          ? h('div', { className: 'gm-empty' }, h('span', { className: 'gm-empty-title' }, t('empty.title')), h('span', null, t('empty.body')))
          : h('ul', { className: 'gm-list' }, entries.map((entry) => h(Entry, {
            key: entry.id,
            t,
            entry,
            busy,
            onToggle: (target) => void mutate('/change', { id: target.id, enabled: target.enabled !== true }),
            onRemove: (id) => void mutate('/change', { id, removed: true }),
            onSave: (id, value) => void mutate('/update', { id, ...value }),
          }))),
      )
    }

    // ---------------------------------------------------------------- plugin

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'global-memory: dictionaries')
      ctx.effect(() => installStyles(), 'global-memory: styles')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: 'global-memory', order: 30, locale: NS, label: () => t('section.title') },
        (props) => h(MemorySettings, { ...props, t }),
      ))
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
