# Saudi Deal Card & Game Logic Scanner — v2.0

Automatically monitors your BlueStacks gameplay and does **two things simultaneously**:

1. **Card Scanner** — detects card names not yet in `SAUDI_DEAL_CARDS_REFERENCE.md` → saved to `unknown_cards.json`
2. **Game Logic Observer** — captures game events (payments, steals, turn flow, notifications, win conditions) → saved to `game_events.json` and human-readable `game_mechanics_notes.md`

---

## How it works

Every 3 seconds the scanner:

1. Finds the BlueStacks window and captures it
2. Crops **7 named screen regions** simultaneously
3. Runs Arabic OCR (Tesseract) on each region
4. Routes the text through two pipelines:
   - **Card pipeline** — compares against the reference file, logs anything unknown
   - **Game logic pipeline** — matches 35 regex patterns covering all observable game events
5. Writes results to 3 output files without blocking gameplay

### 7 Captured Regions

| Region | What it covers |
|--------|---------------|
| `header` | Game title / room info bar at the top |
| `score` | Move counter (0/3), bank balance display |
| `opp_props` | Opponent property grid (face-down/coloured sets visible) |
| `notification` | Center overlay — payment popups, steal notifications, defense prompts |
| `center` | Active play area — the card currently being played |
| `self_props` | Your property grid at the bottom |
| `hand` | Your hand of cards (horizontal strip) |

### 35 Game Logic Event Categories

The scanner recognises events in these groups:

| Group | What it catches |
|-------|----------------|
| Turn events | Start of turn, draw 2, move counter changes |
| Payment events | Rent demand, cross-colour rent, all-player rent |
| Steal actions | سلم واستلم, سوق الهوامير, تمت المصادرة, etc. |
| Hand actions | Steal from hand, discard from hand, card limit exceeded |
| Defense/counter | لا آخذ, ما ودي, رسالة مجانية, ساهر لسلامتكم, etc. |
| Property board | Set completed, wild card played, property moved/stolen |
| Win conditions | First to 3 complete sets, game over screen |
| Draw events | Extra card drawn, hand limit triggered |
| Protection cards | Property marked as protected |
| Auction events | Bidding flow observed |

---

## One-time Setup

### 1. Install Tesseract OCR with Arabic support

Download the Windows installer from:  
**https://github.com/UB-Mannheim/tesseract/wiki**

- Run the installer
- On the **"Additional language data"** screen, expand the list and **check "Arabic"**
- Install to the default path: `C:\Program Files\Tesseract-OCR\`

### 2. Run the setup script

Double-click `setup.bat` — it will:
- Verify Tesseract is installed at the default path
- Verify the Arabic language pack (`ara.traineddata`) is present
- Install all Python dependencies automatically

### 3. Manual install (alternative)

```bash
pip install -r requirements.txt
```

---

## Usage

1. Open BlueStacks and start a **Saudi Deal** game on Jawaker
2. Open a terminal in this folder:

```bash
python scanner.py
```

3. Play normally — the scanner runs in the background
4. Terminal output shows two types of events:

```
[14:32:07] ⚠  UNKNOWN CARD: ازرررررف  (region: center)
[14:32:10] 🎮 GAME EVENT [payment]: طلب إيجار — منطقة الفاكهية
[14:32:19] 🎮 GAME EVENT [steal_action]: تمت المصادرة — مجموعة كاملة مسروقة
```

5. Press **Ctrl+C** to stop — a full event summary is printed to terminal

---

## Output Files

### `unknown_cards.json`

Arabic phrases seen during gameplay that are **not** in the reference file:

```json
{
  "ازرررررف": {
    "first_seen": "2026-03-09 14:32:07",
    "count": 3,
    "region": "center"
  }
}
```

Once you've confirmed a card is real (not OCR noise), ask GitHub Copilot to add it to the reference file.

### `game_events.json`

Structured log of every unique game logic event observed:

```json
{
  "payment|طلب إيجار — منطقة الفاكهية": {
    "category": "payment",
    "description": "طلب إيجار — منطقة الفاكهية",
    "first_seen": "2026-03-09 14:32:10",
    "count": 2,
    "regions": ["notification"],
    "raw_ocr_sample": "طلب إيجار منطقة الفاكهية 5M"
  }
}
```

### `game_mechanics_notes.md`

Human-readable document that **auto-rebuilds after every new event** during a session. Contains:
- All confirmed game mechanics (seeded from known rules)
- Observed event counts grouped by category
- Raw OCR samples as evidence

Share this file with GitHub Copilot to get the reference and replication docs updated.

---

## Accuracy Notes

- OCR accuracy depends on card font size and BlueStacks window zoom — maximise the BlueStacks window for best results
- Phrases shorter than 3 Arabic characters are ignored as noise
- Fuzzy substring matching prevents minor OCR errors from creating duplicate unknowns
- If you get too many false positives, increase `MIN_ARABIC_LEN` at the top of `scanner.py`
- The `SCAN_INTERVAL` constant (default: 3 seconds) controls how frequently regions are captured — lower = more events caught, higher CPU usage

---

## Folder Structure

```
tools/jawaker-card-scanner/
├── scanner.py               ← main scanner (v2.0)
├── requirements.txt         ← Python dependencies
├── setup.bat                ← one-click Windows setup
├── README.md                ← this file
├── unknown_cards.json       ← auto-generated: unrecognised card names
├── game_events.json         ← auto-generated: observed game logic events
└── game_mechanics_notes.md  ← auto-generated: human-readable mechanics doc
└── unknown_cards.json    ← auto-generated during scanning
```
