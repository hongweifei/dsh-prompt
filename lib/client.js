/**
 * Client half of the dsh-prompt bundle: the Settings → Prompt snippets panel and the
 * composer quick toggle. A plain script in the DSH client-module format, NOT an ES module:
 * `require('react')` is the only external, data arrives from the Host half's same-origin
 * `/api/prompt/*` routes, text goes through this plugin's own `prompt` locale namespace
 * (zh/en), and styling uses real `--dsw-*` tokens under the `dshp-` prefix.
 *
 * @module @dsh-external/dsh-prompt/client
 */
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-prompt',
  factory(require) {
    var React = require('react')
    var h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    var NS = 'prompt'

    /** The three injection channels, in panel order, and the locale key family each one uses. */
    var CHANNELS = ['system', 'context', 'message']
    // One table rather than three parallel maps: `name` is the channel's label,
    // `hint` its explanation, `tag` its short badge.
    var NAMES = {
      system: { name: 'channelSystem', hint: 'channelSystemHint', tag: 'tagSystem' },
      context: { name: 'channelContext', hint: 'channelContextHint', tag: 'tagContext' },
      message: { name: 'channelMessage', hint: 'channelMessageHint', tag: 'tagMessage' },
    }

    /** English dictionary (the fallback locale). */
    var en = {
      title: 'Prompt snippets',
      quickLabel: 'Prompt injection',
      intro: 'Reusable snippets injected into the system prompt, the runtime context or a per-turn user message.',
      defaultMode: 'Default mode',
      defaultOn: 'On by default',
      defaultOff: 'Off by default',
      defaultHint: 'What a session that has not chosen for itself gets. The composer button switches one session; it does not change this.',
      on: 'on',
      off: 'off',
      channelSystem: 'System prompt',
      channelContext: 'Runtime context',
      channelMessage: 'Per-turn message',
      channelSystemHint: 'Standing persona and rules, present in every turn.',
      channelContextHint: 'Per-turn environment facts, refreshed with the runtime snapshot.',
      channelMessageHint: 'Transient requirements, sent as a user message at the start of each turn.',
      tagSystem: 'System',
      tagContext: 'Context',
      tagMessage: 'Message',
      session: 'Session',
      sessionNone: 'No session in scope. The composer button switches one session; this page sets the default.',
      effective: 'Effective',
      override: 'Override',
      overrideHint: 'auto follows the default mode; on and off force this session only.',
      ovAuto: 'Follow default',
      ovOn: 'Force on',
      ovOff: 'Force off',
      injectOn: 'Injecting',
      injectOff: 'Not injecting',
      sessionFailed: 'Could not change this session.',
      snippetsTitle: 'Snippets',
      noSnippets: 'No snippets yet — write one below and save it.',
      edit: 'Edit',
      delete: 'Delete',
      confirmDelete: 'Delete this one?',
      cancel: 'Cancel',
      moveUp: 'Move up',
      moveDown: 'Move down',
      turnOn: 'Enable',
      turnOff: 'Disable',
      deletedSnippet: 'Deleted {name}.',
      deleteFailed: 'Could not delete the snippet.',
      movedSnippet: 'Moved {name}.',
      moveFailed: 'Could not reorder the snippets.',
      toggleSnippetFailed: 'Could not change the snippet.',
      editorTitle: 'Editor',
      editorNew: 'New snippet',
      editorEditing: 'Editing {name}',
      name: 'Name',
      target: 'Target',
      order: 'Order',
      text: 'Content',
      namePlaceholder: 'Code style',
      textPlaceholder: 'Answer in Chinese only.',
      nameRequired: 'Give the snippet a name first.',
      save: 'Save',
      create: 'New',
      savedSnippet: 'Saved {name}.',
      saveFailed: 'Could not save the snippet.',
      extrasTitle: 'Session snippets',
      extrasHint: 'They apply to this session only and are gone in the next one.',
      noExtras: 'No session-only snippets.',
      remove: 'Remove',
      confirmExtras: 'This removes all {count} session snippet(s). Continue?',
      extrasCleared: 'Session snippets cleared.',
      clearFailed: 'Could not clear the session snippets.',
      extraNamePlaceholder: 'Name (optional)',
      extraTextPlaceholder: 'A one-off instruction for this session…',
      extraAdd: 'Add',
      extraRequired: 'Write the text first.',
      extraAdded: 'Added to this session.',
      extraAddFailed: 'Could not add the snippet.',
      previewTitle: 'Injection preview',
      previewRun: 'Preview',
      previewHint: 'Composes every enabled snippet the way the next turn would send it.',
      previewUnavailable: 'No preview: {reason}',
      previewChars: '{chars} chars',
      previewEmpty: 'empty',
      previewBudget: '{used} of {max} chars',
      previewFailed: 'Could not build the preview.',
      noteEscaped: 'The runtime-context channel rewrites every "{{" to "{ {" so the harness cannot read it as a prompt variable.',
      noteOff: 'Injection is off for this session, so no channel would contribute.',
      noteTruncated: 'The {channel} channel was truncated to fit the shared injection budget.',
      noteDropped: 'The {channel} channel was dropped entirely to fit the shared injection budget.',
      storageTitle: 'Storage',
      storageFile: 'File',
      storageMissing: 'The store file does not exist yet; the first save creates it.',
      storageError: 'Storage error: {error}',
      unavailable: 'Prompt status is unavailable.',
      toggleFailed: 'Could not change the switch.',
      quickOn: 'Inject on',
      quickOff: 'Inject off',
      quickUnknown: 'Inject?',
      quickForcedOn: 'Forced on for this session',
      quickForcedOff: 'Forced off for this session',
      quickAutoNote: 'Following the default mode',
      quickNextOn: 'Click to turn injection on for this session',
      quickNextOff: 'Click to turn injection off for this session',
      quickFailed: 'Could not change the injection state.',
    }

    /** Chinese dictionary. */
    var zh = {
      title: '提示词片段',
      quickLabel: '提示词注入',
      intro: '可复用的提示词片段，分别注入系统提示词、运行时上下文或每轮用户消息。',
      defaultMode: '默认模式',
      defaultOn: '默认开',
      defaultOff: '默认关',
      defaultHint: '没有单独设置过的会话按这里的默认模式执行。输入框旁的按钮只切换当前会话，不改动这里。',
      on: '开',
      off: '关',
      channelSystem: '系统提示词',
      channelContext: '运行时上下文',
      channelMessage: '每轮用户消息',
      channelSystemHint: '固定的人设与规则，每一轮都在场。',
      channelContextHint: '每轮的环境事实，随运行时快照一起刷新。',
      channelMessageHint: '临时要求，每轮开头作为用户消息发出。',
      tagSystem: '系统',
      tagContext: '上下文',
      tagMessage: '消息',
      session: '会话',
      sessionNone: '当前没有会话。会话级开关在输入框旁，本页设置的是默认模式。',
      effective: '生效',
      override: '覆盖',
      overrideHint: '跟随默认＝听默认模式；强制开／强制关只影响本会话。',
      ovAuto: '跟随默认',
      ovOn: '强制开',
      ovOff: '强制关',
      injectOn: '注入开',
      injectOff: '注入关',
      sessionFailed: '无法修改本会话的状态。',
      snippetsTitle: '片段',
      noSnippets: '还没有片段——在下面写一条并保存。',
      edit: '编辑',
      delete: '删除',
      confirmDelete: '确认删除？',
      cancel: '取消',
      moveUp: '上移',
      moveDown: '下移',
      turnOn: '启用',
      turnOff: '停用',
      deletedSnippet: '已删除 {name}。',
      deleteFailed: '无法删除该片段。',
      movedSnippet: '已移动 {name}。',
      moveFailed: '无法调整顺序。',
      toggleSnippetFailed: '无法修改该片段。',
      editorTitle: '编辑',
      editorNew: '新建片段',
      editorEditing: '正在编辑 {name}',
      name: '名称',
      target: '目标',
      order: '顺序',
      text: '内容',
      namePlaceholder: '代码风格',
      textPlaceholder: '回复一律用中文。',
      nameRequired: '请先填写名称。',
      save: '保存',
      create: '新建',
      savedSnippet: '已保存 {name}。',
      saveFailed: '保存失败。',
      extrasTitle: '会话内片段',
      extrasHint: '只在本会话生效，新会话不会带上。',
      noExtras: '暂无会话内片段。',
      remove: '移除',
      confirmExtras: '这会移除全部 {count} 条会话内片段，继续？',
      extrasCleared: '已清空会话内片段。',
      clearFailed: '无法清空会话内片段。',
      extraNamePlaceholder: '名称（可留空）',
      extraTextPlaceholder: '只在本会话生效的一次性要求…',
      extraAdd: '添加',
      extraRequired: '请先填写内容。',
      extraAdded: '已添加到本会话。',
      extraAddFailed: '无法添加该片段。',
      previewTitle: '注入预览',
      previewRun: '预览',
      previewHint: '按下一轮的实际内容拼好所有已启用的片段。',
      previewUnavailable: '无法预览：{reason}',
      previewChars: '{chars} 字符',
      previewEmpty: '空',
      previewBudget: '{used}／{max} 字符',
      previewFailed: '无法生成预览。',
      noteEscaped: '运行时上下文通道会把每一处「{{」改写成「{ {」，否则宿主会把它当成提示词变量而报错。',
      noteOff: '本会话的注入已关闭，三个通道都不会有内容。',
      noteTruncated: '{channel}通道超出总预算，已被截断。',
      noteDropped: '{channel}通道超出总预算，已被整段舍弃。',
      storageTitle: '存储',
      storageFile: '文件',
      storageMissing: '存储文件还不存在，第一次保存时创建。',
      storageError: '存储出错：{error}',
      unavailable: '提示词状态不可用。',
      toggleFailed: '无法修改开关。',
      quickOn: '注入开',
      quickOff: '注入关',
      quickUnknown: '注入？',
      quickForcedOn: '本会话强制开启',
      quickForcedOff: '本会话强制关闭',
      quickAutoNote: '跟随默认模式',
      quickNextOn: '点击：本会话开启注入',
      quickNextOff: '点击：本会话关闭注入',
      quickFailed: '无法修改注入状态。',
    }

    /** Fetch one JSON endpoint; resolves to `{ ok, status, data }` and never throws. */
    function api(path, init) {
      return fetch(path, init)
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return null
            })
            .then(function (data) {
              return { ok: response.ok, status: response.status, data: data }
            })
        })
        .catch(function (error) {
          return { ok: false, status: 0, data: { error: String(error && error.message ? error.message : error) } }
        })
    }

    /**
     * Stylesheet, prefixed `dshp-`.
     *
     * Copied from the Harness UI primitives (`Button.module.css`, `settings-form/fields.module.css`,
     * `Tag.module.css`, `Input.module.css` in @deepseek-ai/dsh-client-ui-primitives) so this
     * page matches host controls — same radii, heights, type sizes, 0.5px strokes, hover and
     * active fills, focus rings. Only `--dsw-*` tokens from the shipped stylesheets appear
     * here: no literal colour, so the page follows the host theme in light and dark alike.
     */
    var CSS = [
      '.dshp-page{color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:1.5}',
      '.dshp-section{padding:12px 0;border-top:0.5px solid var(--dsw-alias-border-l2)}.dshp-section:first-child{border-top:none;padding-top:0}',
      '.dshp-title{margin:0 0 8px;font-size:13px;font-weight:600;line-height:1.5}.dshp-intro{margin:0 0 8px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-muted{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-field{display:flex;align-items:baseline;gap:12px;padding:6px 0}',
      '.dshp-label{flex:1 1 auto;min-width:max-content;word-break:keep-all;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dshp-value{flex:0 1 auto;min-width:0;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary);text-align:right;overflow-wrap:anywhere}',
      '.dshp-mono{font-family:var(--dsw-font-markdown-code-font-family);font-size:12px;word-break:break-all}',
      '.dshp-list{border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);overflow:hidden;margin-top:8px}',
      '.dshp-block+.dshp-block{border-top:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshp-head{display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--dsw-alias-bg-layer-3)}.dshp-head-name{flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.dshp-row{display:flex;align-items:flex-start;gap:8px;padding:8px 12px}.dshp-row+.dshp-row{border-top:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshp-row-toggle{box-sizing:border-box;flex:none;width:18px;height:18px;margin-top:2px;padding:0;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;font:inherit;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      ".dshp-row-toggle[data-on='true']{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}.dshp-row-toggle:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshp-row-toggle:disabled{cursor:not-allowed;opacity:0.4}",
      '.dshp-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.dshp-row-head{display:flex;align-items:center;gap:6px;min-width:0}',
      '.dshp-row-name{max-width:100%;padding:0;border:none;background:transparent;font:inherit;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshp-row-name:hover{color:var(--dsw-alias-state-business-primary)}.dshp-row-static{cursor:default}.dshp-row-static:hover{color:var(--dsw-alias-label-primary)}',
      '.dshp-row-text{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshp-actions{display:flex;align-items:center;justify-content:flex-end;gap:4px;flex:none;flex-wrap:wrap}.dshp-group{display:flex;align-items:center;gap:4px;flex:none}',
      '.dshp-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);cursor:pointer}',
      '.dshp-btn:disabled{cursor:not-allowed;opacity:0.4}.dshp-btn:focus-visible,.dshp-row-toggle:focus-visible,.dshp-switch:focus-visible,.dshp-quick:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}',
      '.dshp-btn-outline{border:0.5px solid var(--dsw-alias-border-l3)}.dshp-btn-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshp-btn-outline:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.dshp-btn-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}.dshp-btn-danger{color:var(--dsw-alias-label-error);border-color:currentColor}.dshp-btn-danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-error) 10%,transparent)}',
      ".dshp-btn-icon{width:28px;padding:0;font-size:13px}.dshp-choice[data-active='true']{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}",
      '.dshp-switch{box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;flex:none;height:24px;padding:0 10px 0 8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:transparent;font:inherit;font-size:12px;line-height:1;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
      ".dshp-switch[data-on='true']{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}.dshp-switch:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshp-switch:disabled{cursor:not-allowed;opacity:0.4}",
      '.dshp-switch-dot{width:6px;height:6px;border-radius:999px;background:currentColor}',
      '.dshp-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0}.dshp-toggle-row+.dshp-toggle-row{border-top:0.5px solid var(--dsw-alias-border-l2)}',
      '.dshp-toggle-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.dshp-toggle-name{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.dshp-input{box-sizing:border-box;height:34px;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);min-width:0}',
      '.dshp-input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
      '.dshp-select{box-sizing:border-box;height:34px;padding:0 24px 0 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;min-width:0}',
      '.dshp-select option{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}.dshp-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
      '.dshp-textarea{box-sizing:border-box;width:100%;min-height:120px;margin-top:8px;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font-family:var(--dsw-font-markdown-code-font-family);font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary);resize:vertical}',
      '.dshp-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}.dshp-extra{min-height:64px}',
      '.dshp-fields{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}.dshp-field-col{display:flex;flex-direction:column;gap:4px;flex:1 1 140px;min-width:0}',
      '.dshp-field-label{font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary)}.dshp-order-col{flex:0 0 96px}',
      '.dshp-details{border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);margin-top:6px;overflow:hidden}',
      '.dshp-summary{display:flex;align-items:center;gap:6px;padding:8px 12px;cursor:pointer;list-style:none}.dshp-summary:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshp-summary::-webkit-details-marker{display:none}',
      // The caret is the only affordance saying the row opens: a collapsed body without it
      // reads as a label, not as something that opens.
      '.dshp-caret{flex:none;font-size:12px;line-height:1;color:var(--dsw-alias-label-tertiary);transition:transform 0.15s}.dshp-details[open] .dshp-caret{transform:rotate(90deg)}',
      '.dshp-summary-name{flex:1;min-width:0;font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary)}.dshp-summary-meta{flex:none;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.dshp-body{padding:0 12px 10px 30px}.dshp-pre{margin:0;max-height:280px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border:none;background:transparent;padding:0;resize:none}',
      '.dshp-tag{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;white-space:nowrap}',
      ".dshp-tag[data-tone='outline']{border:0.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-tertiary)}.dshp-tag[data-tone='quiet']{color:var(--dsw-alias-label-tertiary)}",
      ".dshp-tag[data-tone='success']{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}.dshp-tag[data-tone='warning']{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary)}",
      '.dshp-note{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}.dshp-note-error{color:var(--dsw-alias-label-error)}.dshp-note-warn{color:var(--dsw-alias-state-warn-primary)}',
      '.dshp-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:12px}.dshp-top{padding-top:0}',
      '.dshp-quick{box-sizing:border-box;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      ".dshp-quick[data-state='on']{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}.dshp-quick[data-state='forced-on'],.dshp-quick[data-state='forced-off']{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary)}.dshp-quick[data-state='error']{border-color:var(--dsw-alias-label-error);color:var(--dsw-alias-label-error)}",
      '.dshp-quick:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dshp-quick-dot{width:6px;height:6px;border-radius:999px;background:currentColor}',
    ].join('\n')

    /** A POST carrying a JSON body. */
    function jsonInit(body) {
      return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
    }

    /**
     * `t` for one channel's locale key, falling back to the raw channel name.
     *
     * @param field - which key family to read: 'name' (label), 'hint', or 'tag' (badge).
     * @param channel - the channel id.
     * @param t - the bound translator.
     * @returns the translated string.
     */
    function channelText(field, channel, t) {
      var row = NAMES[channel]
      return row === undefined ? channel : t(row[field])
    }

    /**
     * Render one host note.
     *
     * The host sends a structured code rather than prose, so the panel can speak
     * the user's language: an English sentence on a Chinese page reads as a bug.
     * An unknown code is shown raw instead of dropped — a warning nobody can see
     * is worse than one phrased awkwardly.
     */
    function noteText(note, t) {
      if (typeof note === 'string') return note
      var code = note === null || note === undefined ? undefined : note.code
      if (code === 'escaped') return t('noteEscaped')
      if (code === 'off') return t('noteOff')
      if (code === 'truncated' || code === 'dropped') {
        var channel = channelText('name', note.channel, t)
        return t(code === 'truncated' ? 'noteTruncated' : 'noteDropped', { channel: channel })
      }
      return JSON.stringify(note)
    }

    /** The host's own error string when it sent one, else a localised fallback. */
    function errorText(result, fallback) {
      var data = result === null || result === undefined ? null : result.data
      if (data !== null && data !== undefined && typeof data.error === 'string' && data.error.length > 0) return data.error
      return fallback
    }

    /** The first 60 characters of a snippet, so a row stays on one line. */
    function snippetPreview(text) {
      var flat = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim()
      return flat.length > 60 ? flat.slice(0, 60) + '…' : flat
    }

    /** A session id short enough to share a line with its folder. `session-` is on every id,
     * so it is stripped: slicing the raw id would show the same characters for all of them. */
    function shortSession(id) {
      var bare = typeof id === 'string' && id.indexOf('session-') === 0 ? id.slice(8) : id
      return typeof bare === 'string' ? bare.slice(0, 8) : ''
    }

    /** A snippet as the editor's draft; an unknown target falls back to `system`. */
    function draftOf(snippet) {
      var target = CHANNELS.indexOf(snippet.target) >= 0 ? snippet.target : 'system'
      return { id: typeof snippet.id === 'string' ? snippet.id : null, name: typeof snippet.name === 'string' ? snippet.name : '', text: typeof snippet.text === 'string' ? snippet.text : '', target: target, enabled: snippet.enabled !== false, order: typeof snippet.order === 'number' ? snippet.order : 100 }
    }

    /** An empty draft: a new snippet starts at order 100, the usual middle ground. */
    function blankDraft() {
      return { id: null, name: '', text: '', target: 'system', enabled: true, order: 100 }
    }

    /** The body `POST /api/prompt/snippet` expects, with `order` replaced. */
    function snippetBody(snippet, order) {
      return { id: snippet.id, name: snippet.name, text: snippet.text, target: snippet.target, enabled: snippet.enabled !== false, order: order }
    }

    /** Ascending `order`, treating a missing one as 0 so it leads its group. */
    function byOrder(left, right) {
      return (typeof left.order === 'number' ? left.order : 0) - (typeof right.order === 'number' ? right.order : 0)
    }

    /** Group snippets by target, ascending order inside each group.
     *
     * The known channels keep the panel's own order; an unexpected target is still shown
     * (last) rather than silently dropped.
     */
    function groupSnippets(snippets) {
      var byTarget = {}
      var targets = []
      var list = snippets === undefined || snippets === null ? [] : snippets
      list.forEach(function (snippet) {
        var target = typeof snippet.target === 'string' && snippet.target.length > 0 ? snippet.target : 'system'
        if (byTarget[target] === undefined) {
          byTarget[target] = []
          targets.push(target)
        }
        byTarget[target].push(snippet)
      })
      var rank = function (target) {
        var index = CHANNELS.indexOf(target)
        return index < 0 ? CHANNELS.length : index
      }
      return targets.sort(function (left, right) { return rank(left) - rank(right) }).map(function (target) {
        return { target: target, snippets: byTarget[target].sort(byOrder) }
      })
    }

    /** The two orders a swap writes: distinct orders are exchanged, which keeps the
     * neighbours they sit between; equal ones (a hand-edited store) fall back to the two
     * positions, because exchanging two identical numbers is a no-op the user cannot see.
     */
    function swapOrders(list, index, delta) {
      var other = index + delta
      if (other < 0 || other >= list.length) return null
      var moved = list[index]
      var neighbour = list[other]
      var a = typeof moved.order === 'number' ? moved.order : index
      var b = typeof neighbour.order === 'number' ? neighbour.order : other
      if (a === b) return [{ snippet: moved, order: other }, { snippet: neighbour, order: index }]
      return [{ snippet: moved, order: b }, { snippet: neighbour, order: a }]
    }

    /**
     * The override one click of the composer button should write.
     *
     * The button flips what is *effective for this session*, and clears the
     * override back to `auto` whenever `auto` would already produce the wanted
     * state. That keeps the store free of overrides that say nothing: with the
     * default off, turning a session on and then off again leaves no trace, so a
     * later change to the default is not blocked by a stale per-session choice
     * the user has forgotten about.
     *
     * @param override - the session's current override.
     * @param defaultEnabled - the panel's default mode.
     * @returns the override to write.
     */
    function nextOverride(override, defaultEnabled) {
      var on = defaultEnabled === true
      var effective = override === 'on' ? true : override === 'off' ? false : on
      if (effective !== on) return 'auto'
      return effective ? 'off' : 'on'
    }

    /** The override the host reported, narrowed to the three legal values. */
    function overrideOf(session) {
      if (session === null || session === undefined) return 'auto'
      return session.override === 'on' || session.override === 'off' ? session.override : 'auto'
    }

    /** The status path for one session, or the global one when there is no session. */
    function statusPath(base, sessionId) {
      return base + (typeof sessionId === 'string' && sessionId.length > 0 ? '?session=' + encodeURIComponent(sessionId) : '')
    }

    /** Tag tones, mirroring the primitive's `data-tone` vocabulary. */
    function Tag(props) {
      return h('span', { className: 'dshp-tag', 'data-tone': props.tone }, props.children)
    }

    /** One label / value line: `value` is a string (mono) or a node. */
    function Row(label, value) {
      var shown = typeof value === 'string' ? h('span', { className: 'dshp-value dshp-mono' }, value) : value
      return h('div', { className: 'dshp-field' }, h('span', { className: 'dshp-label' }, label), shown)
    }

    /** A labelled section: `Section(title, child, child, …)`. The children are spread as
     * separate createElement arguments rather than passed as one array — an array child is
     * a keyed React list, which would warn about missing `key` props on these static rows.
     */
    function Section(title) {
      var args = ['div', { className: 'dshp-section' }, h('div', { className: 'dshp-title' }, title)]
      for (var index = 1; index < arguments.length; index += 1) args.push(arguments[index])
      return h.apply(null, args)
    }

    /** A themed control button: `tone` is `outline` (default), `primary` or `danger`. */
    function Button(props) {
      var tone = props.tone === 'primary' || props.tone === 'danger' ? props.tone : 'outline'
      // `aria-label` is always set: an icon-only button has no text to read.
      var cls = 'dshp-btn dshp-btn-' + tone + (props.icon === true ? ' dshp-btn-icon' : '')
      return h('button', { type: 'button', className: cls, disabled: props.disabled === true, title: props.title, 'aria-label': props.label, onClick: props.onClick }, props.children)
    }

    /** A button whose selected state is visible: the pressed override. */
    function Choice(props) {
      return h('button', { type: 'button', className: 'dshp-btn dshp-btn-outline dshp-choice', 'data-active': String(props.active === true), 'aria-pressed': String(props.active === true), disabled: props.disabled === true, title: props.title, onClick: props.onClick }, props.children)
    }

    /** A pill switch that shows its own state in words, not only by position. */
    function Switch(props) {
      var dot = h('span', { className: 'dshp-switch-dot', 'aria-hidden': 'true' })
      return h('button', { type: 'button', className: 'dshp-switch', 'data-on': String(props.on === true), 'aria-pressed': String(props.on === true), disabled: props.disabled === true, title: props.title, onClick: props.onClick }, dot, props.children)
    }

    /** One switch row: what it governs, why, and the switch itself. */
    function ToggleRow(props) {
      var hint = props.hint === undefined || props.hint === null ? null : h('span', { className: 'dshp-muted' }, props.hint)
      var text = h('span', { className: 'dshp-toggle-text' }, h('span', { className: 'dshp-toggle-name' }, props.name), hint)
      return h('div', { className: 'dshp-toggle-row' }, text, h(Switch, { on: props.on, disabled: props.disabled, title: props.name + ' · ' + props.stateLabel, onClick: props.onClick, children: props.stateLabel }))
    }

    /** A labelled editor control: the label stays visible, so it survives typing. */
    function Field(props) {
      var cls = 'dshp-field-col' + (props.narrow === true ? ' dshp-order-col' : '')
      return h('label', { className: cls }, h('span', { className: 'dshp-field-label' }, props.label), props.children)
    }

    /** The Settings → Prompt snippets panel; `t` comes from the slot's locale namespace. */
    function PromptSection(props) {
      var t = props.t
      var sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      var [status, setStatus] = React.useState(null)
      var [loadError, setLoadError] = React.useState(null)
      var [draft, setDraft] = React.useState(blankDraft)
      var [message, setMessage] = React.useState(null)
      var [busy, setBusy] = React.useState(false)
      // One inline confirmation at a time: a destructive row asks before it acts, and never
      // through a browser dialog the panel could not style or translate.
      var [confirmId, setConfirmId] = React.useState(null)
      // The preview composes every snippet, so it runs on the button — never on the 5s poll.
      var [preview, setPreview] = React.useState(null)
      var [extraText, setExtraText] = React.useState('')
      var [extraName, setExtraName] = React.useState('')

      // Keep the last good snapshot on a transient failure, but say so: a panel that
      // silently freezes is worse than one that admits it is stale.
      var load = React.useCallback(function () {
        return api(statusPath('/api/prompt/status', sessionId)).then(function (result) {
          if (result.ok && result.data) {
            setStatus(result.data)
            setLoadError(null)
          } else setLoadError(errorText(result, t('unavailable')))
          return result
        })
      }, [sessionId, t])

      React.useEffect(function () {
        load()
        var timer = setInterval(load, 5000)
        return function () { clearInterval(timer) }
      }, [load])

      /**
       * Run one panel action: busy flag, one request, one message, never a throw.
       *
       * `ok` may be `null` where the control already shows the new state (a switch) and a
       * success line would only be noise; failures always speak. `settle` lets a caller that
       * renders its own presentation (the preview) take the response instead.
       */
      var act = React.useCallback(function (path, init, ok, failed, settle) {
        setBusy(true)
        setMessage(null)
        var done = function (result) {
          if (settle !== undefined) settle(result)
          else if (result.ok && result.data) {
            if (ok !== null) setMessage({ kind: 'ok', text: ok(result.data) })
          } else setMessage({ kind: 'error', text: errorText(result, t(failed)) })
          setBusy(false)
          return result
        }
        return api(path, init).then(done)
      }, [t])

      var toggle = React.useCallback(function (body) {
        return act('/api/prompt/toggle', jsonInit(body), null, 'toggleFailed').then(load)
      }, [act, load])

      var setOverride = React.useCallback(function (action) {
        return act('/api/prompt/session', jsonInit({ action: action, sessionId: sessionId }), null, 'sessionFailed').then(load)
      }, [act, load, sessionId])

      // Both editor entry points clear the row confirmation and the last message.
      var openDraft = React.useCallback(function (next) {
        setDraft(next)
        setConfirmId(null)
        setMessage(null)
      }, [])
      var editSnippet = function (snippet) { openDraft(draftOf(snippet)) }
      var newDraft = function () { openDraft(blankDraft()) }

      var saveSnippet = React.useCallback(function () {
        var name = draft.name.trim()
        if (name === '') {
          setMessage({ kind: 'error', text: t('nameRequired') })
          return Promise.resolve()
        }
        var body = snippetBody({ id: draft.id, name: name, text: draft.text, target: draft.target, enabled: draft.enabled }, Number(draft.order) || 0)
        if (body.id === null) delete body.id
        var ok = function (data) { return t('savedSnippet', { name: (data.snippet && data.snippet.name) || name }) }
        return act('/api/prompt/snippet', jsonInit(body), ok, 'saveFailed').then(function (result) {
          // Keep the saved row in the editor: a second Save must update it, not create a
          // duplicate. `New` is how another one starts.
          if (result.ok && result.data && result.data.snippet) setDraft(draftOf(result.data.snippet))
          return load()
        })
      }, [act, draft, load, t])

      var toggleSnippet = React.useCallback(function (snippet) {
        var body = snippetBody(snippet, typeof snippet.order === 'number' ? snippet.order : 0)
        body.enabled = snippet.enabled !== true
        return act('/api/prompt/snippet', jsonInit(body), null, 'toggleSnippetFailed').then(load)
      }, [act, load])

      var removeSnippet = React.useCallback(function (snippet) {
        setConfirmId(null)
        var url = '/api/prompt/snippet?id=' + encodeURIComponent(snippet.id)
        var ok = function () { return t('deletedSnippet', { name: snippet.name }) }
        return act(url, { method: 'DELETE' }, ok, 'deleteFailed').then(function (result) {
          // An editor still holding the deleted row would save it straight back.
          setDraft(function (previous) {
            return previous.id === snippet.id ? blankDraft() : previous
          })
          return load()
        })
      }, [act, load, t])

      /**
       * Move one row past its neighbour inside the same target.
       *
       * Both snippets are rewritten, so the swap is one intent — but only the first goes
       * through `act`, whose busy flag and message line the whole panel shares; the second
       * reports its own failure rather than leaving the first one looking settled.
       */
      var moveSnippet = React.useCallback(function (list, index, delta) {
        var pair = swapOrders(list, index, delta)
        if (pair === null) return Promise.resolve()
        var moved = pair[0].snippet
        var first = act('/api/prompt/snippet', jsonInit(snippetBody(pair[0].snippet, pair[0].order)), null, 'moveFailed')
        return first
          .then(function (result) {
            if (!result.ok) return result
            var second = api('/api/prompt/snippet', jsonInit(snippetBody(pair[1].snippet, pair[1].order)))
            return second.then(function (done) {
              if (done.ok) setMessage({ kind: 'ok', text: t('movedSnippet', { name: moved.name }) })
              else setMessage({ kind: 'error', text: errorText(done, t('moveFailed')) })
              return done
            })
          })
          .then(function (result) {
            return load().then(function () {
              return result
            })
          })
      }, [act, load, t])

      var addExtra = React.useCallback(function () {
        var text = extraText.trim()
        if (text === '') {
          setMessage({ kind: 'error', text: t('extraRequired') })
          return Promise.resolve()
        }
        var body = { action: 'add-extra', text: text, sessionId: sessionId }
        var name = extraName.trim()
        if (name !== '') body.name = name
        var ok = function () { return t('extraAdded') }
        return act('/api/prompt/session', jsonInit(body), ok, 'extraAddFailed').then(function (result) {
          if (result.ok) {
            setExtraText('')
            setExtraName('')
          }
          return load()
        })
      }, [act, extraName, extraText, load, sessionId, t])

      // The host route clears the whole list (`clear-extras`) and has no remove-one action,
      // so the row's confirmation names that consequence when more than one is present.
      var clearExtras = React.useCallback(function () {
        setConfirmId(null)
        var body = jsonInit({ action: 'clear-extras', sessionId: sessionId })
        var ok = function () { return t('extrasCleared') }
        return act('/api/prompt/session', body, ok, 'clearFailed').then(load)
      }, [act, load, sessionId, t])

      var runPreview = React.useCallback(function () {
        var settle = function (result) {
          setPreview(result.ok && result.data ? result.data : { available: false, reason: errorText(result, t('previewFailed')) })
        }
        return act(statusPath('/api/prompt/preview', sessionId), undefined, null, null, settle)
      }, [act, sessionId, t])

      if (status === null) {
        var wait = h('div', { className: 'dshp-muted' }, loadError === null ? t('unavailable') : loadError)
        return h('div', { className: 'dshp-page' }, h('style', null, CSS), wait)
      }
      var session = status.session === undefined ? null : status.session
      var inject = status.inject === undefined ? {} : status.inject
      var budget = status.budget === undefined ? {} : status.budget
      var storage = status.storage === undefined ? {} : status.storage
      var groups = groupSnippets(status.snippets)
      var extras = session !== null && Array.isArray(session.extras) ? session.extras : []
      var override = overrideOf(session)
      var defaultOn = status.defaultEnabled === true
      var effective = session !== null ? session.effective === true : defaultOn
      // A controlled select must contain its own value; an unexpected target joins the list.
      var targets = CHANNELS.indexOf(draft.target) >= 0 ? CHANNELS : CHANNELS.concat([draft.target])
      var patch = function (change) {
        setDraft(Object.assign({}, draft, change))
      }
      var onText = function (event, key) {
        patch({ [key]: event.target.value })
      }
      var section = function (title, children) {
        return Section.apply(null, [title].concat(children))
      }
      // A control row: `bar(button, button, …)`, so a toolbar stays one line.
      var bar = function () {
        var args = ['div', { className: 'dshp-toolbar' }].concat(Array.prototype.slice.call(arguments))
        return h.apply(null, args)
      }
      // One pressed control: the default mode writes the setting, the override writes
      // this session. Both are the same shape, so one builder serves them.
      var pressed = function (active, onClick, label) {
        return Choice({ active: active, disabled: busy, onClick: onClick, children: label })
      }
      var choice = function (action, label) {
        return pressed(override === action, function () { setOverride(action) }, label)
      }
      var defaultChoice = function (value, label) {
        return pressed(defaultOn === value, function () { toggle({ defaultEnabled: value }) }, label)
      }
      // The two-step confirmation every destructive row shares: it names the consequence
      // instead of asking a browser dialog the panel cannot translate.
      var confirmBar = function (question, onConfirm, label) {
        var cancel = Button({ disabled: busy, onClick: function () { setConfirmId(null) }, children: t('cancel') })
        return h('span', { className: 'dshp-actions' }, h('span', { className: 'dshp-muted' }, question), Button({ tone: 'danger', disabled: busy, onClick: onConfirm, children: label }), cancel)
      }

      /** One row of the snippet list: toggle, name, tag, preview, action group. */
      function snippetRow(snippet, index, list) {
        var on = snippet.enabled === true
        var toggleButton = h('button', { type: 'button', className: 'dshp-row-toggle', 'data-on': String(on), 'aria-pressed': String(on), 'aria-label': on ? t('turnOff') : t('turnOn'), title: on ? t('turnOff') : t('turnOn'), disabled: busy, onClick: function () { toggleSnippet(snippet) } }, on ? '✓' : '')
        // The name is the load-into-editor control; the row is what the edit targets.
        var name = h('button', { type: 'button', className: 'dshp-row-name', title: snippet.name, onClick: function () { editSnippet(snippet) } }, snippet.name)
        var head = h('span', { className: 'dshp-row-head' }, name, h(Tag, { tone: 'outline' }, channelText('tag', snippet.target, t)), on ? null : h(Tag, { tone: 'quiet' }, t('off')))
        var main = h('span', { className: 'dshp-row-main' }, head, h('span', { className: 'dshp-row-text', title: snippet.text }, snippetPreview(snippet.text)))
        var actions = confirmId === snippet.id
          ? confirmBar(t('confirmDelete'), function () { removeSnippet(snippet) }, t('delete'))
          : h(
              'span',
              { className: 'dshp-actions' },
              Button({ icon: true, label: t('moveUp'), title: t('moveUp'), disabled: busy || index === 0, onClick: function () { moveSnippet(list, index, -1) }, children: '↑' }),
              Button({ icon: true, label: t('moveDown'), title: t('moveDown'), disabled: busy || index === list.length - 1, onClick: function () { moveSnippet(list, index, 1) }, children: '↓' }),
              Button({ disabled: busy, onClick: function () { editSnippet(snippet) }, children: t('edit') }),
              Button({ tone: 'danger', disabled: busy, onClick: function () { setConfirmId(snippet.id) }, children: t('delete') }),
            )
        return h('div', { key: snippet.id, className: 'dshp-row' }, toggleButton, main, actions)
      }

      /** One session-only row: the same shape, minus the ordering controls it has no place for. */
      function extraRow(extra, index) {
        var key = 'extra:' + String(extra.id === undefined ? index : extra.id)
        var label = h('span', { className: 'dshp-row-name dshp-row-static' }, extra.name || snippetPreview(extra.text))
        var head = h('span', { className: 'dshp-row-head' }, label, h(Tag, { tone: 'outline' }, channelText('tag', extra.target, t)))
        var main = h('span', { className: 'dshp-row-main' }, head, h('span', { className: 'dshp-row-text', title: extra.text }, snippetPreview(extra.text)))
        var actions = confirmId === key
          ? confirmBar(t('confirmExtras', { count: extras.length }), clearExtras, t('remove'))
          : h('span', { className: 'dshp-actions' }, Button({ tone: 'danger', disabled: busy, onClick: function () { setConfirmId(key) }, children: t('remove') }))
        return h('div', { key: key, className: 'dshp-row' }, main, actions)
      }

      /** One preview channel: its char count, and the composed text it folds away. */
      function previewChannel(channel, part) {
        var caret = h('span', { className: 'dshp-caret', 'aria-hidden': 'true' }, '▸')
        var chars = t('previewChars', { chars: typeof part.chars === 'number' ? part.chars : 0 })
        var summary = h('summary', { className: 'dshp-summary' }, caret, h('span', { className: 'dshp-summary-name' }, channelText('name', channel, t)), h('span', { className: 'dshp-summary-meta' }, chars))
        var body = part.text ? h('pre', { className: 'dshp-textarea dshp-mono dshp-pre' }, part.text) : h('div', { className: 'dshp-muted' }, t('previewEmpty'))
        return h('details', { key: channel, className: 'dshp-details' }, summary, h('div', { className: 'dshp-body' }, body))
      }

      var previewNotes = preview !== null && preview.available === true ? preview.notes || [] : []

      // 1. The default mode, then one row per channel: what it is, why, and its own state.
      //    The default is what a session that has not chosen for itself gets — it is NOT a
      //    master kill switch, so a session forced on from the composer keeps injecting.
      var head = section(t('title'), [
        h('div', { className: 'dshp-intro' }, t('intro')),
        Row(t('defaultMode'), h('span', { className: 'dshp-group' }, defaultChoice(false, t('defaultOff')), defaultChoice(true, t('defaultOn')))),
        h('div', { className: 'dshp-muted' }, t('defaultHint')),
        CHANNELS.map(function (channel) {
          var on = inject[channel] === true
          var change = {}
          change[channel] = !on
          return h(ToggleRow, { key: channel, name: channelText('name', channel, t), hint: channelText('hint', channel, t), on: on, stateLabel: on ? t('on') : t('off'), disabled: busy, onClick: function () { toggle({ inject: change }) } })
        }),
      ])

      // 2. Which session the panel is looking at, and the override in force for it.
      var where = session === null ? t('sessionNone') : shortSession(session.id) + (session.cwd === undefined || session.cwd === null ? '' : ' · ' + session.cwd)
      var sessionSection = section(t('session'), [
        Row(t('session'), where),
        Row(t('effective'), h(Tag, { tone: effective ? 'success' : 'quiet' }, effective ? t('injectOn') : t('injectOff'))),
        Row(t('override'), h('span', { className: 'dshp-group' }, choice('auto', t('ovAuto')), choice('on', t('ovOn')), choice('off', t('ovOff')))),
        h('div', { className: 'dshp-muted' }, t('overrideHint')),
      ])

      // 3. The snippets, grouped by channel in ascending order.
      var snippetSection = section(t('snippetsTitle'), [
        groups.length === 0
          ? h('div', { className: 'dshp-muted' }, t('noSnippets'))
          : h('div', { className: 'dshp-list' }, groups.map(function (group) {
              var head = h('span', { className: 'dshp-head-name' }, channelText('name', group.target, t))
              var count = h(Tag, { tone: 'outline' }, String(group.snippets.length))
              var rows = group.snippets.map(function (snippet, index) { return snippetRow(snippet, index, group.snippets) })
              return h('div', { key: group.target, className: 'dshp-block' }, h('div', { className: 'dshp-head' }, head, count), rows)
            })),
      ])

      // 4. The editor: one snippet at a time, with the id that decides create vs update.
      var editorSection = section(t('editorTitle'), [
        h('div', { className: 'dshp-fields' },
          Field({ label: t('name'), children: h('input', { className: 'dshp-input', value: draft.name, spellCheck: false, placeholder: t('namePlaceholder'), onChange: function (event) { onText(event, 'name') } }) }),
          Field({ label: t('target'), children: h('select', { className: 'dshp-select', value: draft.target, onChange: function (event) { onText(event, 'target') } }, targets.map(function (value) { return h('option', { key: value, value: value }, channelText('name', value, t)) })) }),
          Field({ label: t('order'), narrow: true, children: h('input', { className: 'dshp-input', type: 'number', value: draft.order, onChange: function (event) { onText(event, 'order') } }) }),
        ),
        h('textarea', { className: 'dshp-textarea', value: draft.text, spellCheck: false, 'aria-label': t('text'), placeholder: t('textPlaceholder'), onChange: function (event) { onText(event, 'text') } }),
        bar(Button({ tone: 'primary', disabled: busy, onClick: saveSnippet, children: t('save') }), Button({ disabled: busy, onClick: newDraft, children: t('create') }), Button({ disabled: busy, onClick: newDraft, children: t('cancel') }), h('span', { className: 'dshp-muted' }, draft.id === null ? t('editorNew') : t('editorEditing', { name: draft.name }))),
        message === null ? null : h('p', { className: 'dshp-note' + (message.kind === 'error' ? ' dshp-note-error' : '') }, message.text),
      ])

      // 5. Session-only snippets: not persisted, so they are their own list.
      var extrasSection = section(t('extrasTitle'), [
        h('div', { className: 'dshp-muted' }, t('extrasHint')),
        extras.length === 0
          ? h('div', { className: 'dshp-muted' }, t('noExtras'))
          : h('div', { className: 'dshp-list' }, extras.map(function (extra, index) { return extraRow(extra, index) })),
        h('textarea', { className: 'dshp-textarea dshp-extra', value: extraText, spellCheck: false, 'aria-label': t('extrasTitle'), placeholder: t('extraTextPlaceholder'), onChange: function (event) { setExtraText(event.target.value) } }),
        bar(h('input', { className: 'dshp-input', value: extraName, spellCheck: false, 'aria-label': t('name'), placeholder: t('extraNamePlaceholder'), onChange: function (event) { setExtraName(event.target.value) } }), Button({ disabled: busy, onClick: addExtra, children: t('extraAdd') })),
      ])

      // 6. The preview runs on the button only; its own budget wins over the status one.
      var spent = preview !== null && preview.available === true && preview.budget ? preview.budget : budget
      var hint = preview === null ? t('previewHint') : preview.available === true ? t('previewBudget', { used: spent.usedChars, max: spent.maxChars }) : t('previewUnavailable', { reason: preview.reason || t('previewFailed') })
      var run = Button({ disabled: busy, onClick: runPreview, children: t('previewRun') })
      var previewBody = null
      if (preview !== null && preview.available === true) {
        var channels = CHANNELS.map(function (channel) { return previewChannel(channel, preview[channel] === undefined ? {} : preview[channel]) })
        var warnings = previewNotes.map(function (note, index) { return h('p', { key: 'note-' + index, className: 'dshp-note dshp-note-warn' }, noteText(note, t)) })
        previewBody = h('div', null, channels, warnings)
      }      var previewSection = section(t('previewTitle'), [h('div', { className: 'dshp-toolbar dshp-top' }, run, h('span', { className: 'dshp-muted' }, hint)), previewBody])

      // 7. Where the snippets live, and whether that file could be read.
      var storageSection = section(t('storageTitle'), [
        Row(t('storageFile'), storage.path === undefined || storage.path === null ? '' : String(storage.path)),
        storage.exists === false ? h('div', { className: 'dshp-muted' }, t('storageMissing')) : null,
        storage.error ? h('p', { className: 'dshp-note dshp-note-error' }, t('storageError', { error: storage.error })) : null,
      ])

      return h('div', { className: 'dshp-page' }, h('style', null, CSS), loadError === null ? null : h('p', { className: 'dshp-note dshp-note-error' }, loadError),
        head, sessionSection, snippetSection, editorSection, extrasSection, previewSection, storageSection)
    }

    /** The composer tool-row button: the effective state, and one click to change it. */
    function QuickToggle(props) {
      var t = props.t
      var given = typeof props.sessionId === 'string' && props.sessionId.length > 0 ? props.sessionId : null
      var sessionId = given !== null ? given : props.session !== undefined && props.session !== null && typeof props.session.id === 'string' ? props.session.id : ''
      var [status, setStatus] = React.useState(null)
      var [error, setError] = React.useState(null)

      var load = React.useCallback(function () {
        return api(statusPath('/api/prompt/status', sessionId)).then(function (result) {
          if (result.ok && result.data) {
            setStatus(result.data)
            setError(null)
          } else setError(errorText(result, t('quickFailed')))
          return result
        })
      }, [sessionId, t])

      React.useEffect(function () {
        load()
        var timer = setInterval(load, 10000)
        return function () { clearInterval(timer) }
      }, [load])

      // A failure keeps its message on the button instead of throwing: this control lives in
      // the composer, where an exception would take the row down with it.
      var flip = React.useCallback(function () {
        if (status === null) return Promise.resolve()
        var action = nextOverride(overrideOf(status.session), status.defaultEnabled === true)
        return api('/api/prompt/session', jsonInit({ action: action, sessionId: sessionId })).then(function (result) {
          if (result.ok && result.data) return load()
          setError(errorText(result, t('quickFailed')))
          return result
        })
      }, [load, sessionId, status, t])

      var session = status === null || status.session === undefined ? null : status.session
      var override = overrideOf(session)
      var effective = session !== null ? session.effective === true : status !== null && status.defaultEnabled === true
      var known = status !== null
      var label = known ? (effective ? t('quickOn') : t('quickOff')) : t('quickUnknown')
      // A session forced against the default looks different from one that merely follows it.
      var forced = override === 'on' || override === 'off'
      var tone = known ? (forced ? (effective ? 'forced-on' : 'forced-off') : effective ? 'on' : 'off') : 'off'
      var now = forced ? (effective ? t('quickForcedOn') : t('quickForcedOff')) : t('quickAutoNote')
      // The title names what the NEXT click does, so the button needs no manual.
      var next = known ? (effective ? t('quickNextOff') : t('quickNextOn')) : t('quickAutoNote')
      var title = known ? now + ' · ' + next : t('quickAutoNote')
      if (error !== null) {
        label = t('quickUnknown')
        tone = 'error'
        title = error
      }

      // A fragment keeps the button the only box in the composer row, while the style
      // element still unmounts with the component.
      return h(React.Fragment, null, h('style', null, CSS),
        h('button', { type: 'button', className: 'dshp-quick', 'data-state': tone, 'aria-pressed': String(effective), 'aria-label': label, title: title, onClick: flip }, h('span', { className: 'dshp-quick-dot', 'aria-hidden': 'true' }), label))
    }

    return {
      name: 'prompt-ui',
      // `locale` is required: the slot layer injects the bound `t` prop.
      inject: ['slots', 'locale'],
      apply: function (ctx) {
        var t = ctx.locale.bind(NS)
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en })
        }, 'prompt-ui: dictionaries')
        // The nav label is re-read on every projection, so it follows the locale.
        ctx.slots.inject('settings.section', function () {
          var label = function () { return t('title') }
          return ctx.slots.register({ name: 'settings.section', id: 'prompt', order: 70, label: label, locale: NS }, PromptSection)
        })
        ctx.slots.inject('conversation.input.left', function () {
          var label = function () { return t('quickLabel') }
          return ctx.slots.register({ name: 'conversation.input.left', id: 'prompt-toggle', order: 40, label: label, locale: NS }, QuickToggle)
        })
      },
    }
  },
})
