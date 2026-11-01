"""Prepare/clean only this pet test's disposable fixture threads via public HTTP."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

repo = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(repo / 'scripts/desktop-fixture'))
from backend import read_state, device_api  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'cleanup'])
    args = parser.parse_args()
    evidence = os.environ.get('POCKYMOE_DESKTOP_EVIDENCE')
    if not evidence:
        raise RuntimeError('Set POCKYMOE_DESKTOP_EVIDENCE to an external evidence directory.')
    path = Path(evidence) / 'round3/pet/conversations/fixture.json'
    state = read_state()
    if args.command == 'prepare':
        if path.exists() and not json.loads(path.read_text()).get('cleaned'):
            raise RuntimeError('Conversation fixture already prepared; clean it up first.')
        first, second = state['devices'][:2]
        created = []
        data = {'created': created}
        path.parent.mkdir(parents=True, exist_ok=True)
        def save():
            path.write_text(json.dumps(data, indent=2))
        def create(device, title, parent=None):
            body = {'workspaceId': device['workspaces'][0]['id'], 'provider': 'codex', 'agentId': 'codex',
                    'model': 'ios-e2e-stream', 'approvalMode': 'guarded', 'title': title}
            if parent:
                body['parentThreadId'] = parent
            thread = device_api(state, device, '/threads/start', 'POST', body)
            created.append({'deviceId': device['id'], 'threadId': thread['id']})
            save()
            return thread['id']
        root = create(first, 'app')
        children = [create(first, f'relay-{i}', root) for i in range(5)]
        twin = create(second, 'app')
        data.update(rootThreadId=root, children=children, twinThreadId=twin,
                    deviceId=first['id'], otherDeviceId=second['id'])
        save()
        for i, thread in enumerate(children):
            device_api(state, first, '/e2e/events', 'POST', {'type': 'start', 'threadId': thread})
            kind = 'approval' if i < 2 else 'fail' if i == 2 else 'complete' if i == 3 else None
            if kind:
                device_api(state, first, '/e2e/events', 'POST', {'type': kind, 'threadId': thread})
        device_api(state, second, '/e2e/events', 'POST', {'type': 'start', 'threadId': twin})
        print('Prepared seven disposable threads: root, five children, duplicate-title root on another device.')
    else:
        data = json.loads(path.read_text())
        removed = data.setdefault('removed', [])
        devices = {device['id']: device for device in state['devices']}
        for record in reversed(data['created']):
            if record in removed:
                continue
            device, thread = devices[record['deviceId']], record['threadId']
            try:
                device_api(state, device, '/e2e/events', 'POST', {'type': 'complete', 'threadId': thread})
                time.sleep(.1)
            except Exception:
                pass  # Completed/idle disposable turns have no live fake controller.
            device_api(state, device, f'/threads/{thread}', 'DELETE')
            removed.append(record)
            path.write_text(json.dumps(data, indent=2))
        data['cleaned'] = True
        data['totalAfterCleanup'] = sum(len(device_api(state, device, '/threads?includeAgentThreads=true')) for device in state['devices'])
        path.write_text(json.dumps(data, indent=2))
        print(f"Deleted only this test's {len(removed)} disposable threads.")


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Conversation fixture operation failed; authentication data omitted.', file=sys.stderr)
        raise SystemExit(1)
