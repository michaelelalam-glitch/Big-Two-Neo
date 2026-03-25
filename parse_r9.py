import json

filepath = "/Users/michaelalam/Desktop/Desktop/Coding/Coding/Big-Two-Neo/content.json"

with open(filepath) as f:
    data = json.load(f)

threads = data.get('review_threads', [])
new_count = 0
for i, t in enumerate(threads):
    comments = t.get('comments', [])
    if not comments:
        continue
    fc = comments[0]
    created = fc.get('created_at', '')
    # Round 9 comments would be after Round 8 at 23:53:48Z
    if created > '2026-03-25T04:17:00Z':
        new_count += 1
        print(f"\n=== NEW THREAD #{new_count} (index {i+1}/{len(threads)}) ===")
        print(f"File: {fc.get('path', '')}")
        print(f"Line: {fc.get('line', '')}")
        print(f"Created: {created}")
        print(f"Resolved: {t.get('is_resolved', False)}")
        print(f"Outdated: {t.get('is_outdated', False)}")
        print(f"\nBody:\n{fc.get('body', '')}")
        print(f"\nDiff hunk (last 8 lines):")
        hunk = fc.get('diffHunk', fc.get('diff_hunk', ''))
        for line in hunk.split('\n')[-8:]:
            print(f"  {line}")
        print('---')

print(f"\nTotal new Round 25 comments: {new_count}")
