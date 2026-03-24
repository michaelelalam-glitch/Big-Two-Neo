import json, sys

with open(sys.argv[1]) as f:
    data = json.load(f)

if isinstance(data, list):
    items = data
elif isinstance(data, dict) and 'items' in data:
    items = data['items']
else:
    print("Unknown format:", type(data))
    sys.exit(1)

new_comments = []
outdated_comments = []

for c in items:
    if isinstance(c, str):
        print("String item:", c[:200])
        continue
    is_outdated = c.get('position') is None or c.get('line') is None
    entry = {
        'id': c.get('id'),
        'path': c.get('path', ''),
        'line': c.get('line'),
        'body': str(c.get('body', ''))[:200],
        'user': c.get('user', {}).get('login', '') if isinstance(c.get('user'), dict) else '',
    }
    if is_outdated:
        outdated_comments.append(entry)
    else:
        new_comments.append(entry)

print(f"\n=== NEW (non-outdated) comments: {len(new_comments)} ===")
for c in new_comments:
    print(f"  ID:{c['id']} | {c['path']}:{c['line']} | @{c['user']}")
    print(f"    {c['body']}")
    print()

print(f"=== OUTDATED comments: {len(outdated_comments)} ===")
for c in outdated_comments:
    print(f"  ID:{c['id']} | {c['path']} | @{c['user']} | {c['body'][:80]}")
