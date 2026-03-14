#!/usr/bin/env python3
"""
Jawaker Saudi Deal — Card & Game Logic Scanner  v2.0
======================================================
Monitors a running BlueStacks window and performs two jobs simultaneously:

  1. CARD SCANNER
     OCR-reads Arabic card names and flags anything not yet in
     SAUDI_DEAL_CARDS_REFERENCE.md → unknown_cards.json

  2. GAME LOGIC OBSERVER
     Captures text from every UI region (notifications, score bar, property
     grid, turn indicator, overlays) and classifies it into game events so
     you can reverse-engineer the complete game loop → game_events.json
     A human-readable summary is kept up-to-date in game_mechanics_notes.md

Regions captured each scan cycle:
  ┌─────────────────────────────────────────────────┐
  │  [header]  game title / menu bar               │
  │  [score]   avatar + bank + move counter        │
  │  [opp_props] opponent property grid (top)      │
  │  [notification] center overlay / played card   │
  │  [center]  main played card zone               │
  │  [self_props] own property grid (middle-bottom)│
  │  [hand]    player's held cards (bottom strip)  │
  └─────────────────────────────────────────────────┘
"""

import time
import re
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional
from collections import defaultdict

try:
    import pytesseract
    from PIL import Image, ImageEnhance, ImageFilter
    import mss
    import win32gui
except ImportError as e:
    print(f"\n[ERROR] Missing dependency: {e}")
    print("Please run:  pip install -r requirements.txt\n")
    sys.exit(1)

# ══════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════

TESSERACT_PATH  = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
SCAN_INTERVAL   = 3        # seconds between scans
MIN_ARABIC_LEN  = 3        # minimum Arabic chars to bother processing

BASE_DIR        = Path(__file__).parent
REPO_ROOT       = BASE_DIR.parent.parent

REFERENCE_FILE  = REPO_ROOT / 'docs' / 'lebanese deal' / 'SAUDI_DEAL_CARDS_REFERENCE.md'
UNKNOWNS_LOG    = BASE_DIR / 'unknown_cards.json'
EVENTS_LOG      = BASE_DIR / 'game_events.json'
MECHANICS_NOTES = BASE_DIR / 'game_mechanics_notes.md'

pytesseract.pytesseract.tesseract_cmd = TESSERACT_PATH

# ══════════════════════════════════════════════════════════
# GAME EVENT CLASSIFIERS
# Known game-logic phrases extracted from prior OCR sessions.
# Each tuple: (regex_pattern, event_category, description_template)
# ══════════════════════════════════════════════════════════

GAME_PATTERNS = [
    # ── Turn & Move system ────────────────────────────────
    (r'(\d+)\s*/\s*3',                       'turn_move_counter',
     'Move counter observed: {0}/3'),

    # ── Payment events ────────────────────────────────────
    (r'ادفع',                                'payment_demand',
     'Payment demand shown to player (ادفع = "pay")'),
    (r'على جميع اللاعبين.{2,30}إيجار',       'rent_all_players',
     'Rent collected from ALL players — الإيجار card played'),
    (r'الدفع لك.{2,40}إيجار',               'rent_collected',
     'Rent collection confirmed — player receives rent'),
    (r'اختر أحد اللاعبين.{2,30}يدفع لك',    'targeted_payment',
     'Targeted payment: one player forced to pay'),
    (r'غرامة.{2,20}3',                       'fine_3m',
     'Fine of 3م charged — likely ساهر لسلامتكم card'),

    # ── Card played against you overlay ───────────────────
    (r'لعبت هذه الورقة ضدك',                'card_played_against',
     'Notification: "This card was played against you"'),
    (r'لا يوجد لديك بطاقات تحميك',           'no_defense_cards',
     'Notification: player has no defense cards available'),

    # ── Steal / Force events ──────────────────────────────
    (r'اسحب أرض.{2,40}لاعب',               'property_steal',
     'Property steal action observed'),
    (r'بدل أي أرض.{2,40}أرض',              'force_deal',
     'Force deal (swap property) action observed — اعطيني أعطيك'),
    (r'اسحب ورقة عشوائية',                  'blind_steal_hand',
     'Blind steal from hand: random card taken from a player'),
    (r'اسحب مجموعة',                        'deal_breaker',
     'Deal Breaker steal: entire property set taken — رحت فيها'),
    (r'بشرط ألا تكون ضمن مجموعة مكتملة',   'not_in_complete_set',
     'Action targets a property NOT in a complete set (Sly Deal / ازرررررف / تمت المصادرة)'),

    # ── Hand actions ──────────────────────────────────────
    (r'بدّل.{2,20}أوراق.{2,20}لاعب',       'hand_swap',
     'Hand swap: entire hand exchanged with another player — سلم واستلم'),
    (r'تساوى الورق',                         'hand_swap_confirm',
     'Hand swap confirm: no requirement for equal card values'),
    (r'اكشف.{2,20}أوراق',                   'reveal_hand',
     'Hand reveal: player forced to show hand — المستور card'),
    (r'يكشف لك أوراقه',                      'reveal_hand',
     'Hand reveal confirmed — target shows cards to active player'),

    # ── Turn control ──────────────────────────────────────
    (r'العب دورك مرة أخرى',                  'extra_turn',
     'Extra turn granted — واسطة card played'),
    (r'تلعب هذه الورقة تغيير حركة',          'extra_turn_move_change',
     'Extra turn note: this card changes your move count'),
    (r'حركاته.{2,30}حركة واحدة',            'move_limiter',
     'Move limiter: target player next turn limited to 1 move'),
    (r'الدور القادم.{2,30}حركة واحدة',       'move_limiter',
     'Move limiter active: next turn restricted to 1 move'),
    (r'ارفض أي أمر لعب ضدك',               'just_say_no',
     'Just Say No counter played — تبطي عظم or بالمشمش'),
    (r'تخطى|تخطي',                           'skip_turn',
     'Skip/pass button observed — opponent turn skipped'),

    # ── Property board state ──────────────────────────────
    (r'مجموعة مكتملة',                       'set_complete',
     'Complete property set detected on board'),
    (r'(\d+)\s*م\s*(\d+)\s*م\s*(\d+)\s*م',  'property_rent_values',
     'Property rent value ladder observed: {0}م / {1}م / {2}م'),
    (r'لزيادة قيمة الإيجار',                 'upgrade_card_used',
     'Upgrade card (بيت/فندق/مسجد) placed on a complete set'),

    # ── Win condition ─────────────────────────────────────
    (r'فاز|فازت|انتهت اللعبة|اللعبة انتهت', 'game_over',
     'Game over / winner detected'),
    (r'(\d)\s*/\s*3\s*مجموعات',             'sets_progress',
     'Sets collected progress: {0}/3 toward win condition'),

    # ── Draw / Deck ───────────────────────────────────────
    (r'اسحب ورقتين|حبتين السحب',            'draw_two',
     'Draw 2 extra cards — حبتين السحب card played'),
    (r'البنك|الرصيد',                        'bank_reference',
     'Bank / balance label visible in UI'),

    # ── Protection ────────────────────────────────────────
    (r'أحمِ أراضيك من السرقة',               'shield_active',
     'Shield active — عدم تعرض protecting all properties for 2 turns'),
    (r'لدورين',                              'shield_duration',
     'Shield duration noted: 2 turns'),
    (r'تضاف على مجموعة فكتملة لحمايتها',    'set_lock',
     'Set lock placed — لا يحوشك added to a complete set'),

    # ── Auction / Purchase ────────────────────────────────
    (r'اشتري أرض.{2,40}من أي لاعب',        'property_auction',
     'Property purchase at price — سوق الهوامير card'),
    (r'ضمن مجموعة مكتملة',                   'not_in_complete_set_auction',
     'Auction rule: property must not be in a complete set'),
]


# ══════════════════════════════════════════════════════════
# REFERENCE PARSING
# ══════════════════════════════════════════════════════════

def parse_reference_cards(filepath: Path) -> set:
    cards = set()
    content = filepath.read_text(encoding='utf-8')

    bold_pattern = re.compile(r'\*\*([\u0600-\u06FF][^\*]{1,50})\*\*')
    for m in bold_pattern.finditer(content):
        name = re.sub(r'\s*\([^)]+\)\s*$', '', m.group(1).strip()).strip()
        if name and re.search(r'[\u0600-\u06FF]{2,}', name):
            cards.add(name)

    cell_pattern = re.compile(r'\|\s*([\u0600-\u06FF][^\|\n]{1,50})\s*\|')
    for m in cell_pattern.finditer(content):
        for part in re.split(r'[·\u00B7]', m.group(1).strip()):
            part = part.strip()
            if part and re.search(r'[\u0600-\u06FF]{2,}', part):
                cards.add(part)

    return cards


# ══════════════════════════════════════════════════════════
# WINDOW & SCREEN CAPTURE
# ══════════════════════════════════════════════════════════

def find_bluestacks_window() -> Optional[int]:
    found = []
    def _cb(hwnd, _):
        if win32gui.IsWindowVisible(hwnd) and 'BlueStacks' in win32gui.GetWindowText(hwnd):
            found.append(hwnd)
    win32gui.EnumWindows(_cb, None)
    return found[0] if found else None


def capture_window(hwnd: int):
    left, top, right, bottom = win32gui.GetWindowRect(hwnd)
    w, h = right - left, bottom - top
    with mss.mss() as sct:
        shot = sct.grab({'top': top, 'left': left, 'width': w, 'height': h})
        img  = Image.frombytes('RGB', shot.size, shot.bgra, 'raw', 'BGRX')
    return img, w, h


def get_all_regions(img: Image.Image, w: int, h: int) -> list:
    """
    Return all named regions of the screen.
    Percentages are tuned from observed Saudi Deal BlueStacks layout.
    """
    return [
        # label,           left%,  top%,   right%, bottom%
        ('header',         0.00,   0.00,   1.00,   0.13),   # title bar + menu
        ('score',          0.00,   0.13,   0.45,   0.35),   # avatar, bank M, move counter
        ('opp_props',      0.28,   0.13,   1.00,   0.45),   # opponent property grid
        ('notification',   0.10,   0.28,   0.90,   0.82),   # full-screen overlays / pop-ups
        ('center',         0.25,   0.35,   0.75,   0.72),   # played card zone
        ('self_props',     0.10,   0.60,   1.00,   0.82),   # own property grid rows
        ('hand',           0.00,   0.78,   1.00,   1.00),   # held cards strip
    ]


# ══════════════════════════════════════════════════════════
# OCR PIPELINE
# ══════════════════════════════════════════════════════════

def preprocess(img: Image.Image) -> Image.Image:
    w, h = img.size
    img = img.resize((w * 2, h * 2), Image.LANCZOS)
    img = ImageEnhance.Contrast(img).enhance(2.0)
    img = img.filter(ImageFilter.SHARPEN)
    return img.convert('L')


def run_ocr(img: Image.Image) -> str:
    return pytesseract.image_to_string(
        preprocess(img),
        lang='ara',
        config='--psm 6 --oem 3'
    )


def ocr_region(img: Image.Image, w: int, h: int, lp: float, tp: float, rp: float, bp: float) -> str:
    crop = img.crop((int(w*lp), int(h*tp), int(w*rp), int(h*bp)))
    return run_ocr(crop)


def extract_arabic_phrases(text: str) -> list:
    pattern = re.compile(r'[\u0600-\u06FF][\u0600-\u06FF\s\u0640\u064b-\u065f]{1,60}[\u0600-\u06FF]')
    return [m.strip() for m in pattern.findall(text) if m.strip()]


def extract_numbers(text: str) -> list:
    """Extract standalone numbers (money amounts, counters)."""
    return re.findall(r'\b\d{1,3}\b', text)


# ══════════════════════════════════════════════════════════
# CARD MATCHING
# ══════════════════════════════════════════════════════════

def is_known_card(phrase: str, known_cards: set) -> bool:
    for card in known_cards:
        if phrase in card or card in phrase:
            return True
    return False


# ══════════════════════════════════════════════════════════
# GAME EVENT CLASSIFICATION
# ══════════════════════════════════════════════════════════

def classify_text(text: str) -> list:
    """
    Run all GAME_PATTERNS against raw OCR text.
    Returns list of (category, description) tuples for every match.
    """
    results = []
    for pattern, category, desc_template in GAME_PATTERNS:
        m = re.search(pattern, text)
        if m:
            try:
                desc = desc_template.format(*m.groups())
            except (IndexError, KeyError):
                desc = desc_template
            results.append((category, desc, text.strip()[:200]))
    return results


# ══════════════════════════════════════════════════════════
# PERSISTENCE
# ══════════════════════════════════════════════════════════

def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}


def save_json(path: Path, data: dict):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')


def update_events_log(events_log: dict, region: str, category: str, desc: str, raw: str):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    key = f"{category}|{desc[:60]}"
    if key not in events_log:
        events_log[key] = {
            'category': category,
            'description': desc,
            'first_seen': ts,
            'count': 1,
            'regions': [region],
            'raw_ocr_sample': raw,
        }
    else:
        events_log[key]['count'] += 1
        if region not in events_log[key]['regions']:
            events_log[key]['regions'].append(region)


def build_mechanics_notes(events_log: dict, unknowns: dict) -> str:
    """Generate / refresh game_mechanics_notes.md from accumulated observations."""
    ts  = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # Group events by category
    by_cat: dict = defaultdict(list)
    for entry in events_log.values():
        by_cat[entry['category']].append(entry)

    lines = [
        '# Saudi Deal — Game Mechanics Observations',
        f'> Auto-generated by scanner.py | Last updated: {ts}',
        '',
        '---',
        '',
        '## Overview (from reference + scanner)',
        '',
        '| Property | Value |',
        '|---|---|',
        '| Players | 4 |',
        '| Win Condition | First to collect 3 complete property sets of different colors |',
        '| Moves per turn | 3 (draw 2 cards, then play up to 3) |',
        '| Card total | ~110–120 |',
        '| No-change rule | Overpayment is lost (no فكة) |',
        '',
        '---',
        '',
        '## Turn Structure (observed)',
        '',
        '1. **Draw phase** — player draws 2 cards from the deck',
        '2. **Action phase** — player may play up to **3 moves**',
        '   - Play a card from hand to bank (money)',
        '   - Play an action card',
        '   - Place a property card onto the board',
        '   - (each of these costs 1 move)',
        '3. Turn passes clockwise',
        '',
        '> Move counter UI: shown as `X/3` next to the player avatar.',
        '',
        '---',
        '',
    ]

    category_labels = {
        'turn_move_counter':        '## Turn & Move Counter',
        'payment_demand':           '## Payment / Rent Events',
        'rent_all_players':         '## Payment / Rent Events',
        'rent_collected':           '## Payment / Rent Events',
        'targeted_payment':         '## Payment / Rent Events',
        'fine_3m':                  '## Payment / Rent Events',
        'card_played_against':      '## Notification Overlays',
        'no_defense_cards':         '## Notification Overlays',
        'property_steal':           '## Steal & Force Actions',
        'force_deal':               '## Steal & Force Actions',
        'blind_steal_hand':         '## Steal & Force Actions',
        'deal_breaker':             '## Steal & Force Actions',
        'not_in_complete_set':      '## Steal & Force Actions',
        'hand_swap':                '## Hand Actions',
        'hand_swap_confirm':        '## Hand Actions',
        'reveal_hand':              '## Hand Actions',
        'extra_turn':               '## Turn Control',
        'extra_turn_move_change':   '## Turn Control',
        'move_limiter':             '## Turn Control',
        'just_say_no':              '## Defense / Counters',
        'skip_turn':                '## Defense / Counters',
        'set_complete':             '## Property Board State',
        'property_rent_values':     '## Property Board State',
        'upgrade_card_used':        '## Property Board State',
        'game_over':                '## Win / End Game',
        'sets_progress':            '## Win / End Game',
        'draw_two':                 '## Deck & Draw Events',
        'bank_reference':           '## Deck & Draw Events',
        'shield_active':            '## Protection Cards',
        'shield_duration':          '## Protection Cards',
        'set_lock':                 '## Protection Cards',
        'property_auction':         '## Auction / Purchase',
        'not_in_complete_set_auction': '## Auction / Purchase',
    }

    seen_headers = set()
    for cat, entries in sorted(by_cat.items()):
        header = category_labels.get(cat, f'## {cat}')
        if header not in seen_headers:
            lines.append(header)
            lines.append('')
            lines.append('| Observation | Seen | Regions |')
            lines.append('|---|---|---|')
            seen_headers.add(header)
        for e in entries:
            regions_str = ', '.join(e['regions'])
            lines.append(f"| {e['description']} | ×{e['count']} | {regions_str} |")
        lines.append('')

    lines += [
        '---',
        '',
        '## Unknown Cards Pending Confirmation',
        '',
        '| OCR Text | Count | First Seen | Region |',
        '|---|---|---|---|',
    ]
    # Only show entries that look like real card names (≥7 chars, not gibberish)
    meaningful = {k: v for k, v in unknowns.items()
                  if len(k.replace('\n', '').replace(' ', '')) >= 6
                  and re.search(r'[\u0600-\u06FF]{4,}', k)}
    for name, info in sorted(meaningful.items(), key=lambda x: -x[1]['count']):
        safe_name = name.replace('\n', ' ').replace('|', '/')
        lines.append(f"| {safe_name} | ×{info['count']} | {info['first_seen']} | {info['region']} |")

    lines += [
        '',
        '---',
        '',
        f'*Generated by scanner.py — {ts}*',
    ]

    return '\n'.join(lines)


# ══════════════════════════════════════════════════════════
# MAIN LOOP
# ══════════════════════════════════════════════════════════

def main():
    print('=' * 66)
    print('  Saudi Deal Card & Game Logic Scanner  v2.0')
    print('=' * 66)

    if not REFERENCE_FILE.exists():
        print(f'\n[ERROR] Reference file not found:\n  {REFERENCE_FILE}\n')
        sys.exit(1)

    print('\n[1/3] Loading reference file ...')
    known_cards = parse_reference_cards(REFERENCE_FILE)
    print(f'      {len(known_cards)} known card entries loaded.')

    unknowns   = load_json(UNKNOWNS_LOG)
    events_log = load_json(EVENTS_LOG)
    print(f'      {len(unknowns)} unknown cards | {len(events_log)} game events in logs.')

    print('\n[2/3] Searching for BlueStacks window ...')
    hwnd = find_bluestacks_window()
    if not hwnd:
        print('      [ERROR] BlueStacks not found. Start a game then retry.\n')
        sys.exit(1)
    print(f'      Found window (HWND={hwnd}).')

    print(f'\n[3/3] Scanning every {SCAN_INTERVAL}s — Ctrl+C to stop.')
    print('      Outputs: unknown_cards.json | game_events.json | game_mechanics_notes.md\n')
    print('-' * 66)

    seen_session:   set = set()
    scan_count:     int = 0
    events_changed: bool = False
    cards_changed:  bool = False

    try:
        while True:
            hwnd = find_bluestacks_window()
            if not hwnd:
                print(f'[{datetime.now():%H:%M:%S}] BlueStacks window lost — retrying in 5s')
                time.sleep(5)
                continue

            img, w, h = capture_window(hwnd)
            scan_count += 1
            new_cards, new_events = [], []

            for label, lp, tp, rp, bp in get_all_regions(img, w, h):
                raw_text = ocr_region(img, w, h, lp, tp, rp, bp)
                if not raw_text.strip():
                    continue

                # ── 1. Game logic classification ──────────────────────────
                for category, desc, raw in classify_text(raw_text):
                    key = f"{category}|{desc[:60]}"
                    if key not in seen_session:
                        seen_session.add(key)
                        update_events_log(events_log, label, category, desc, raw)
                        new_events.append(f'[{label}] {desc}')
                        events_changed = True
                    else:
                        # Still increment count even if seen before
                        full_key = f"{category}|{desc[:60]}"
                        if full_key in events_log:
                            events_log[full_key]['count'] += 1

                # ── 2. Card name scanning ─────────────────────────────────
                if label in ('hand', 'center', 'notification'):
                    for phrase in extract_arabic_phrases(raw_text):
                        if len(phrase) < MIN_ARABIC_LEN or phrase in seen_session:
                            continue
                        seen_session.add(phrase)
                        if not is_known_card(phrase, known_cards):
                            ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                            if phrase not in unknowns:
                                unknowns[phrase] = {
                                    'first_seen': ts, 'count': 1, 'region': label
                                }
                                new_cards.append(phrase)
                                cards_changed = True
                            else:
                                unknowns[phrase]['count'] += 1

            # ── Print & save ───────────────────────────────────────────────
            ts_now = datetime.now().strftime('%H:%M:%S')
            if new_cards or new_events:
                print()
                for c in new_cards:
                    print(f'[{ts_now}] ⚠  UNKNOWN CARD : {c}')
                for e in new_events:
                    print(f'[{ts_now}] 🎮 GAME EVENT  : {e}')

                if cards_changed:
                    save_json(UNKNOWNS_LOG, unknowns)
                    cards_changed = False
                if events_changed:
                    save_json(EVENTS_LOG, events_log)
                    MECHANICS_NOTES.write_text(
                        build_mechanics_notes(events_log, unknowns),
                        encoding='utf-8'
                    )
                    events_changed = False
            else:
                print(
                    f'[{ts_now}] ✓ Scan #{scan_count:04d} — '
                    f'{len(events_log)} events | {len(unknowns)} unknowns | '
                    f'{len(seen_session)} phrases seen',
                    end='\r'
                )

            time.sleep(SCAN_INTERVAL)

    except KeyboardInterrupt:
        # Final save
        save_json(UNKNOWNS_LOG, unknowns)
        save_json(EVENTS_LOG, events_log)
        MECHANICS_NOTES.write_text(
            build_mechanics_notes(events_log, unknowns), encoding='utf-8'
        )

        print(f'\n\n{"=" * 66}')
        print('Session Summary')
        print(f'  Scans completed  : {scan_count}')
        print(f'  Phrases seen     : {len(seen_session)}')
        print(f'  Game events      : {len(events_log)}')
        print(f'  Unknown cards    : {len(unknowns)}')
        print(f'  Outputs saved to : {BASE_DIR}')
        print('=' * 66)

        if events_log:
            print('\nGame events by category:')
            by_cat: dict = defaultdict(int)
            for e in events_log.values():
                by_cat[e['category']] += e['count']
            for cat, count in sorted(by_cat.items(), key=lambda x: -x[1]):
                print(f'  {cat:<35} ×{count}')
        print()


if __name__ == '__main__':
    main()

