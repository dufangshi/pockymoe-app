export const contentQualityZhCN = {
  'quality.report.reviewed': '已审阅',
  'quality.report.connected': '连接成功',
  'quality.report.repliesDisabled': '自动回复润色已关闭',
  'quality.report.noReply': '没有可润色的回复',
  'quality.report.shortReply': '回复未达到最短长度',
  'quality.report.alreadyPolished': '回复已润色',
  'quality.report.turnNotCompleted': '回合未成功完成',
  'quality.report.exceedsContextBudget':
    '回复原文超过参考字数上限（{{maxChars}} 字），未润色；可在设置中调高上限。',
  'quality.report.exceedsContextBudgetPlain':
    '回复原文超过参考字数上限，未润色；可在设置中调高上限。',
  'quality.report.unsupportedMarkup': '不支持该文档标记格式',
  'quality.report.fileWritten': '已写入文件',
  'quality.report.fileUnchanged': '文件未更改',
  'quality.report.findingOne': '1 条意见',
  'quality.report.findingCount': '{{value1}} 条意见',
  'quality.report.findings': '审阅意见',
  'quality.report.noFindings': '未报告问题。',
  'quality.report.diff': '建议差异',
  'quality.report.proposal': '建议修订文本',
  'quality.report.reply': '回复润色',
  'quality.report.scanError': '文档扫描失败',
  'quality.report.noDocuments': '未审阅任何文档。',
  'quality.report.moreDocuments': '本次还有符合条件的文档未被审阅。',
  'quality.name': '内容质量',
  'quality.description':
    '用你选择的模型为读者重写较长的智能体回复，并审阅或改写文档。',
  'quality.connection': '连接',
  'quality.connectionEmpty': '选择一个已保存的连接，或用 + 添加。',
  'quality.connectionUnavailable': '此处无法选择已保存的连接。',
  'quality.connectionHint':
    '本设备上保存的上游连接。选择它不会改动任何 harness。',
  'quality.connectionLegacyHint':
    '仍在使用之前的连接设置。选择一个已保存的连接即可替换。',
  'quality.model': '模型',
  'quality.language': '输出语言',
  'quality.languageHint': '语言标签，例如 zh-CN 或 en。',
  'quality.preset': '写作预设',
  'quality.preset.concise': '简洁',
  'quality.preset.concise.description': '先给结论，去掉重复和求解过程。',
  'quality.preset.clear': '清晰',
  'quality.preset.clear.description':
    '可自由重组以便阅读：先讲结果，删去过程性叙述，事实一条不丢。',
  'quality.preset.technical': '技术',
  'quality.preset.technical.description': '保留准确术语、实现细节和约束。',
  'quality.preset.beginner': '新手友好',
  'quality.preset.beginner.description':
    '面向新手重写：可重组结构，解释术语，必要时补充比喻。',
  'quality.preset.copyedit': '文字校订',
  'quality.preset.copyedit.description':
    '轻度改动：只修正语法和措辞，保留原有结构和风格。',
  'quality.detail': '详细程度',
  'quality.detail.short': '简短',
  'quality.detail.balanced': '适中',
  'quality.detail.detailed': '详细',
  'quality.readerBackground': '读者背景',
  'quality.readerBackgroundHint': '可选：读者的经验与需求。',
  'quality.minReplyChars': '自动润色触发长度（字符数）',
  'quality.minReplyCharsHint':
    '最终回复正文达到此字符数后，才在回合结束时自动润色；代码不计入，较短的回复保持原样。',
  'quality.contextLimitsNeedUpdate':
    '更新此设备的 Supervisor 后才能限制润色上下文；在此之前润色会读取整个对话。',
  'quality.replyContextTurns': '参考轮数',
  'quality.replyContextTurnsHint':
    '润色时参考最近几轮对话，含正在润色的这一轮。',
  'quality.replyContextMaxChars': '参考字数上限',
  'quality.replyContextMaxCharsHint':
    '参考的消息正文总字符数，含待润色的回复（按字符计，不是 token）。优先保留最新内容；待润色回复本身超过上限时不会润色，可调高此值。',
  'quality.autoReplies': '自动润色较长的回复',
  'quality.autoRepliesHint':
    '插件启用时生效。始终保留原始回复。润色可能产生模型使用费用。',
  'quality.autoDocuments': '自动审阅已更改的文档',
  'quality.autoDocumentsHint':
    '插件启用时，在每次成功的回合结束时审阅最多 5 个已修改或未跟踪的文档，结果显示在自动化历史中。自动审阅不会改写文件或阻止提交，可能产生模型费用。',
  'quality.documentMode': '默认手动文档操作',
  'quality.documentMode.review': '审阅：返回意见和修改建议',
  'quality.documentMode.rewrite': '改写：直接写入修订后的文件',
  'quality.documentModeHint':
    '手动审阅返回意见和修改建议，手动改写会直接写入修订后的文件。自动文档审阅始终使用审阅模式。',
  'quality.loading': '正在加载设置…',
  'quality.saving': '正在保存…',
  'quality.save': '保存设置',
  'quality.saved': '设置已保存。',
  'quality.reload': '重新加载已保存的设置',
  'quality.reloadHint': '重新加载会用最新保存的设置替换当前修改。',
  'quality.loadError': '无法加载设置，请重新加载以重试。',
  'quality.saveError': '无法保存设置。已保留当前修改，请重试保存。',
  'quality.conflict':
    '设置已在其他位置更改。已保留当前修改，请重新加载最新设置后再保存。',
  'quality.polished': '润色后',
  'quality.original': '原文',
  'quality.replyVersion': '回复版本',
} as const;
