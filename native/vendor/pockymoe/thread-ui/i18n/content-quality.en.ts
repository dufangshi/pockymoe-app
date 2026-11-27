export const contentQualityEn = {
  'quality.report.reviewed': 'Reviewed',
  'quality.report.connected': 'Connection succeeded',
  'quality.report.repliesDisabled': 'Automatic reply polishing is disabled',
  'quality.report.noReply': 'No reply to polish',
  'quality.report.shortReply': 'Reply is below the minimum length',
  'quality.report.alreadyPolished': 'Reply is already polished',
  'quality.report.turnNotCompleted': 'Turn did not complete successfully',
  'quality.report.exceedsContextBudget':
    'The reply is longer than the context limit ({{maxChars}} characters), so it was not polished. Raise the limit in settings to polish it.',
  'quality.report.exceedsContextBudgetPlain':
    'The reply is longer than the context character limit, so it was not polished. Raise the limit in settings to polish it.',
  'quality.report.unsupportedMarkup': 'Document markup is unsupported',
  'quality.report.fileWritten': 'File written',
  'quality.report.fileUnchanged': 'File unchanged',
  'quality.report.findingOne': '1 finding',
  'quality.report.findingCount': '{{value1}} findings',
  'quality.report.findings': 'Findings',
  'quality.report.noFindings': 'No findings reported.',
  'quality.report.diff': 'Proposed diff',
  'quality.report.proposal': 'Proposed revised text',
  'quality.report.reply': 'Reply polishing',
  'quality.report.scanError': 'Document scan failed',
  'quality.report.noDocuments': 'No documents reviewed.',
  'quality.report.moreDocuments':
    'Additional eligible documents were not reviewed in this run.',
  'quality.name': 'Content Quality',
  'quality.description':
    'Rewrite long agent replies for readers and review or rewrite documents with your chosen model.',
  'quality.connection': 'Connection',
  'quality.connectionEmpty': 'Choose a saved connection, or add one with +.',
  'quality.connectionUnavailable': 'Saved connections cannot be chosen here.',
  'quality.connectionHint':
    'A saved upstream connection on this device. Choosing one does not change any harness.',
  'quality.connectionLegacyHint':
    'An earlier connection setup is still in use. Choose a saved connection to replace it.',
  'quality.model': 'Model',
  'quality.language': 'Output language',
  'quality.languageHint': 'Language tag, for example zh-CN or en.',
  'quality.preset': 'Writing preset',
  'quality.preset.concise': 'Concise',
  'quality.preset.concise.description':
    'Lead with the answer; drop repetition and the steps taken to get there.',
  'quality.preset.clear': 'Clear',
  'quality.preset.clear.description':
    'Reorganize freely for readability: lead with the result, drop process notes, keep every fact.',
  'quality.preset.technical': 'Technical',
  'quality.preset.technical.description':
    'Keep precise terminology, implementation details and constraints.',
  'quality.preset.beginner': 'Beginner friendly',
  'quality.preset.beginner.description':
    'Rewrite for newcomers: reorganize, explain terms and add analogies where they help.',
  'quality.preset.copyedit': 'Copyedit',
  'quality.preset.copyedit.description':
    'Light touch: fix grammar and wording, keep structure and voice.',
  'quality.detail': 'Level of detail',
  'quality.detail.short': 'Short',
  'quality.detail.balanced': 'Balanced',
  'quality.detail.detailed': 'Detailed',
  'quality.readerBackground': 'Reader background',
  'quality.readerBackgroundHint':
    'Optional context about the reader’s experience and needs.',
  'quality.minReplyChars': 'Auto-polish trigger length (characters)',
  'quality.minReplyCharsHint':
    "Auto-polish runs when the turn ends only if the final reply's prose, not counting code, is at least this many characters; shorter replies stay as they are.",
  'quality.contextLimitsNeedUpdate':
    "Update this device's Supervisor to limit polishing context; until then polishing reads the whole conversation.",
  'quality.replyContextTurns': 'Context turns',
  'quality.replyContextTurnsHint':
    'Recent turns read for polishing, including the one being polished.',
  'quality.replyContextMaxChars': 'Context character limit',
  'quality.replyContextMaxCharsHint':
    'Total characters of message text read, including the reply being polished (characters, not tokens). Newest text is kept first; a reply longer than this is not polished, so raise the limit if needed.',
  'quality.autoReplies': 'Automatically polish long replies',
  'quality.autoRepliesHint':
    'Applies when this plugin is enabled. Original replies are always retained. Polishing may incur model usage charges.',
  'quality.autoDocuments': 'Automatically review changed documents',
  'quality.autoDocumentsHint':
    'With this plugin enabled, review up to 5 modified or untracked documents after a successful turn. Findings appear in automation history. Automatic review does not rewrite files or block commits and may incur model charges.',
  'quality.documentMode': 'Default manual document action',
  'quality.documentMode.review': 'Review — findings and proposed changes',
  'quality.documentMode.rewrite': 'Rewrite — write the revised file',
  'quality.documentModeHint':
    'Manual review returns findings and a proposal. Manual rewrite writes the revised file. Automatic document reviews always use review mode.',
  'quality.loading': 'Loading settings…',
  'quality.saving': 'Saving…',
  'quality.save': 'Save settings',
  'quality.saved': 'Settings saved.',
  'quality.reload': 'Reload saved settings',
  'quality.reloadHint':
    'Reloading replaces your edits with the latest saved settings.',
  'quality.loadError': 'Unable to load settings. Reload to try again.',
  'quality.saveError':
    'Unable to save settings. Your edits are retained; try saving again.',
  'quality.conflict':
    'Settings changed elsewhere. Your edits are retained. Reload the latest settings before saving again.',
  'quality.polished': 'Polished',
  'quality.original': 'Original',
  'quality.replyVersion': 'Reply version',
} as const;
