import json
import sys

filepath = '/Users/michaelalam/Library/Application Support/Code/User/workspaceStorage/8e095a4cdc10474df7f9feb788b81a05/GitHub.copilot-chat/chat-session-resources/a1cb8f3e-0244-4c8a-a167-173c3c6c1112/toolu_bdrk_011VUpU4S5PJ9UXj8JAPbGnc__vscode-1774340172921/content.json'

with open(filepath) as f:
    data = json.load(f)

print(f"Total threads: {data.get('totalCount')}")
print(f"Page info: {data.get('pageInfo')}")

threads = data.get('review_threads', [])
new_count = 0
for i, t in enumerate(threads):
    comments = t.get('comments', [])
    if not comments:
        continue
    first_comment = comments[0]
    created = first_comment.get('createdAt', '')
    if created > '2026-03-24T23:50:00Z':
        new_count += 1
        print(f"\n=== NEW THREAD #{new_count} (thread index {i+1}) ===")
        print(f"File: {first_comment.get('path', '')}")
        print(f"Line: {first_comment.get('line', '')}")
        print(f"Created: {created}")
        print(f"Resolved: {t.get('isResolved', False)}")
        print(f"Outdated: {first_comment.get('outdated', False)}")
        body = first_comment.get('body', '')
        print(f"Body:\n{body}")
        print(f"\nDiff hunk (last 5 lines):")
        hunk = first_comment.get('diffHunk', '')
        for line in hunk.split('\n')[-5:]:
            print(f"  {line}")

if new_count == 0:
    print("\nNo new Round 8 comments found!")
else:
    print(f"\nTotal new Round 8 comments: {new_count}")
