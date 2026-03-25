import json, sys

fp = sys.argv[1]
with open(fp) as f:
    data = json.load(f)

threads = data.get('review_threads', [])
for i, t in enumerate(threads):
    if not t.get('is_outdated', False):
        comments = t.get('comments', [])
        last = comments[-1] if comments else {}
        created = last.get('created_at', '')
        path = t.get('path', '?')
        line = t.get('line', '?')
        if created > '2026-03-25T08:57':
            print(f'[NEW] Thread {i}: {path}:{line} ({created})')
            print(f'  Body: {last.get("body", "")}')
            print()
