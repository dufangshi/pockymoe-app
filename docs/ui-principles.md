# Native shell UI principles

The maintained Web/shared UI rules are in the Pockymoe control-plane repository's
`docs/ui-principles.md`. Mobile shells follow those rules and
[the approved mobile design](mobile-design.zh.md); product screens remain Web UI.

## §6 — ActivityKit exception

ActivityKit system surfaces use the Web status SVGs as static vector resources.
The running ring does not loop: ActivityKit prohibits custom looping animation.
A system `Text(timerInterval:)` with monospaced digits communicates elapsed running
time instead. Waiting remains an amber speech bubble and failure a red diamond.
Theme packs change the Web surface; the system activity card follows system light
and dark appearance, as mobile design §6 requires.
