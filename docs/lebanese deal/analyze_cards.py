from PIL import Image
import numpy as np

def find_card_rows(path, name):
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    w, h = img.size
    
    # Get background color from corners
    bg_color = arr[0, 0, :3]
    
    row_whiteness = []
    for y in range(h):
        row = arr[y, :, :3]
        matches = np.all(row == bg_color, axis=1).sum()
        row_whiteness.append(matches / w)
    
    card_row_starts = []
    card_row_ends = []
    prev_is_bg = True
    for y, ws in enumerate(row_whiteness):
        is_bg = ws > 0.80
        if prev_is_bg and not is_bg:
            card_row_starts.append(y)
        if not prev_is_bg and is_bg:
            card_row_ends.append(y)
        prev_is_bg = is_bg
    
    # Also find column separators (to count cards per row)
    # Use first card row or full image
    col_whiteness = []
    for x in range(w):
        col = arr[:, x, :3]
        matches = np.all(col == bg_color, axis=1).sum()
        col_whiteness.append(matches / h)
    
    col_starts = []
    prev_bg = True
    for x, cs in enumerate(col_whiteness):
        is_bg = cs > 0.80
        if prev_bg and not is_bg:
            col_starts.append(x)
        prev_bg = is_bg
    
    print(f"\n=== {name.upper()} ===")
    print(f"Image: {w}×{h}px, bg={bg_color}")
    print(f"Card ROWS: {len(card_row_starts)}")
    for i, (s, e) in enumerate(zip(card_row_starts, card_row_ends[:len(card_row_starts)])):
        print(f"  Row {i+1}: y={s}-{e} (h={e-s}px)")
    if len(card_row_ends) < len(card_row_starts):
        print(f"  Row {len(card_row_starts)}: y={card_row_starts[-1]}-{h} (unclosed)")
    print(f"Card COLUMNS detected: {len(col_starts)} → {col_starts[:10]}")
    return len(card_row_starts), len(col_starts)

totals = {}
for name in ["action", "money", "property", "wild"]:
    rows, cols = find_card_rows(f"/tmp/{name}_cards.png", name)
    totals[name] = rows * cols
    print(f"  ESTIMATED TOTAL {name}: {rows} rows × {cols} cols = {rows*cols} cards")
