import json, sys

filepath = '/Users/michaelalam/Library/Application Support/Code/User/workspaceStorage/8e095a4cdc10474df7f9feb788b81a05/GitHub.copilot-chat/chat-session-resources/a1cb8f3e-0244-4c8a-a167-173c3c6c1112/toolu_bdrk_01GPLezqLozEzHWCq9KktiHP__vscode-1774340172735/content.json'

with open(filepath) as f:
    data = json.load(f)

threads = data.get('review_threads', [])
new_count = 0
outdated_count = 0

for i, t in enumerate(threads):
    is_outdated = t.get('is_outdated', False)
    is_resolved = t.get('is_resolved', False)
    comments = t.get('comments', [])
    first = comments[0] if comments else {}
    body = first.get('body', '')[:300]
    path = first.get('path', '')
    line = first.get('line', '')
    created = first.get('created_at', '')

    if is_outdated:
        outdated_count += 1
    else:
        new_count += 1
        print(f'NEW #{i+1} [resolved={is_resolved}] {path}:{line} ({created})')
        print(f'  {body}')
        print()

print(f'SUMMARY: {new_count} ACTIVE, {outdated_count} OUTDATED')
